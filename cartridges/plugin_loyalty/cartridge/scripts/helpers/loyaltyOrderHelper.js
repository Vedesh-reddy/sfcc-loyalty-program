'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Order = require('dw/order/Order');
var loyalty = require('*/cartridge/scripts/helpers/loyaltyHelper');

// A custom price adjustment: promotion calculation leaves it in place between recalculations.
var ADJUSTMENT_ID = 'loyalty-points';
var DAY = 86400000;

/**
 * @param {dw.order.LineItemCtnr} container - basket or order
 * @returns {string|null} the registered customer's number
 */
function customerNoOf(container) {
    var customer = container.customer;
    return customer && customer.registered && customer.profile ? customer.profile.customerNo : null;
}

/**
 * @param {dw.order.LineItemCtnr} container - basket or order
 * @returns {number} product value after every discount, including points; no shipping or tax
 */
function netProductValue(container) {
    return container.productLineItems.toArray().reduce(function (sum, line) {
        return sum + line.proratedPrice.value;
    }, 0);
}

/**
 * Applies the requested points as an order discount. Runs after the base calculation.
 * @param {dw.order.Basket} basket - current basket
 * @returns {boolean} true when the discount changed and totals need recalculating
 */
function syncBasket(basket) {
    var adjustment = basket.getPriceAdjustmentByPromotionID(ADJUSTMENT_ID);
    var requested = basket.custom.loyaltyPointsRequested || 0;
    var customerNo = requested && loyalty.enabled() ? customerNoOf(basket) : null;
    var account = customerNo ? loyalty.getAccount(customerNo) : null;
    var current = adjustment ? -adjustment.priceValue : 0;
    var merchandise = basket.getAdjustedMerchandizeTotalPrice(true).value + current;
    var points = account ? loyalty.usable(requested, account.custom.balance, merchandise) : 0;
    var value = loyalty.valueOf(points);
    basket.custom.loyaltyPointsApplied = points;
    if (!points) {
        if (adjustment) basket.removePriceAdjustment(adjustment);
        return !!adjustment;
    }
    if (adjustment && current === value) return false;
    adjustment = adjustment || basket.createPriceAdjustment(ADJUSTMENT_ID);
    adjustment.setPriceValue(-value);
    adjustment.setLineItemText(require('dw/web/Resource').msgf('adjustment', 'loyalty', null, points));
    return true;
}

/**
 * Takes the applied points from the balance when the order is created. Caller owns the transaction.
 * @param {dw.order.Order} order - order just created from the basket
 * @param {number} points - points applied on the basket
 */
function reserve(order, points) {
    var account = loyalty.getAccount(customerNoOf(order));
    if (!account) throw new Error('LOYALTY_NO_ACCOUNT');
    var consumed = loyalty.debit(account, points, order.orderNo);
    var record = CustomObjectMgr.createCustomObject('LoyaltyOrder', order.orderNo);
    record.custom.customerNo = account.custom.key;
    record.custom.status = 'CREATED';
    record.custom.redeemedPoints = points;
    record.custom.redemptionDetail = JSON.stringify(consumed);
    record.custom.redemptionRefunded = false;
    order.custom.loyaltyPointsRedeemed = points;
}

/**
 * Records the points a placed order will earn, as pending. Safe to call twice.
 * @param {dw.order.Order} order - placed order
 */
function recordEarn(order) {
    var customerNo = customerNoOf(order);
    if (!customerNo || !loyalty.enabled()) return;
    var account = loyalty.ensureAccount(customerNo);
    var existing = CustomObjectMgr.getCustomObject('LoyaltyOrder', order.orderNo);
    if (existing && existing.custom.status !== 'CREATED') return;
    var base = netProductValue(order);
    var tier = account.custom.tier || 'SILVER';
    var points = loyalty.pointsFor(base, tier);
    Transaction.wrap(function () {
        var record = existing || CustomObjectMgr.createCustomObject('LoyaltyOrder', order.orderNo);
        record.custom.customerNo = customerNo;
        record.custom.status = 'PENDING';
        record.custom.baseAmount = base;
        record.custom.currency = order.currencyCode;
        record.custom.tier = tier;
        record.custom.earnRate = loyalty.earnPercent(tier);
        record.custom.pendingPoints = points;
        account.custom.pending = (account.custom.pending || 0) + points;
    });
}

/**
 * Ends a loyalty order without earning: refunds redeemed points once and drops pending points.
 * @param {dw.object.CustomObject} record - LoyaltyOrder
 * @param {string} status - FAILED or CANCELLED
 */
function close(record, status) {
    Transaction.wrap(function () {
        var account = loyalty.getAccount(record.custom.customerNo);
        if (record.custom.redeemedPoints && !record.custom.redemptionRefunded) {
            loyalty.restore(account, JSON.parse(record.custom.redemptionDetail || '[]'), record.custom.key);
            record.custom.redemptionRefunded = true;
        }
        if (record.custom.status === 'PENDING') account.custom.pending = Math.max(0, (account.custom.pending || 0) - (record.custom.pendingPoints || 0));
        record.custom.status = status;
    });
}

/**
 * Refunds the points of an order whose payment or placement failed.
 * @param {dw.order.Order} order - failed order
 */
function refundFailed(order) {
    var record = CustomObjectMgr.getCustomObject('LoyaltyOrder', order.orderNo);
    if (record && record.custom.status === 'CREATED') close(record, 'FAILED');
}

/**
 * @param {dw.order.Order} order - source order
 * @returns {boolean} true when the order, or every one of its shipments, is shipped
 */
function shipped(order) {
    if (order.shippingStatus.value === Order.SHIPPING_STATUS_SHIPPED) return true;
    var Shipment = require('dw/order/Shipment');
    var shipments = order.shipments.toArray();
    return shipments.length > 0 && shipments.every(function (shipment) {
        return shipment.shippingStatus.value === Shipment.SHIPPING_STATUS_SHIPPED;
    });
}

/**
 * @param {dw.order.Order} order - source order
 * @returns {number} net value of authorized return quantities
 */
function returnedValue(order) {
    return order.returnCaseItems.toArray().reduce(function (sum, item) {
        var line = item.lineItem;
        if (item.status && item.status.value === 'CANCELLED') return sum;
        return line && line.quantityValue ? sum + ((line.proratedPrice.value / line.quantityValue) * item.authorizedQuantity.value) : sum;
    }, 0);
}

/**
 * Decides the next step for a loyalty order.
 * ponytail: "delivered" is the order, or all its shipments, reaching SHIPPED | upgrade path: store the carrier delivery date when the OMS sends one
 * @param {dw.order.Order} order - source order
 * @param {dw.object.CustomObject} record - LoyaltyOrder
 * @param {Date} now - evaluation time
 * @returns {{action: string, reason: ?string}} WAIT, RECORD, CLOSE, DELIVERED or RELEASE
 */
function evaluate(order, record, now) {
    var status = order ? order.status.value : Order.ORDER_STATUS_FAILED;
    if (status === Order.ORDER_STATUS_FAILED) return { action: 'CLOSE', reason: 'FAILED' };
    if (status === Order.ORDER_STATUS_CANCELLED) return { action: 'CLOSE', reason: 'CANCELLED' };
    if (status === Order.ORDER_STATUS_CREATED) return { action: 'WAIT', reason: 'NOT_PLACED' };
    if (record.custom.status === 'CREATED') return { action: 'RECORD', reason: null };
    if (order.paymentStatus.value !== Order.PAYMENT_STATUS_PAID) return { action: 'WAIT', reason: 'NOT_PAID' };
    if (!shipped(order)) return { action: 'WAIT', reason: 'NOT_DELIVERED' };
    if (!record.custom.deliveredAt) return { action: 'DELIVERED', reason: null };
    if (now.getTime() < record.custom.deliveredAt.getTime() + (loyalty.pref('LoyaltyReturnWindowDays') * DAY)) {
        return { action: 'WAIT', reason: 'RETURN_WINDOW' };
    }
    return { action: 'RELEASE', reason: null };
}

/**
 * Turns pending points into available points, less any returned items.
 * @param {dw.object.CustomObject} record - LoyaltyOrder
 * @param {dw.order.Order} order - source order
 * @param {Date} now - release time
 */
function release(record, order, now) {
    var base = Math.max(0, record.custom.baseAmount - returnedValue(order));
    var points = loyalty.pointsFor(base, record.custom.tier || 'SILVER');
    var account = loyalty.getAccount(record.custom.customerNo);
    Transaction.wrap(function () {
        account.custom.pending = Math.max(0, (account.custom.pending || 0) - (record.custom.pendingPoints || 0));
        if (points) loyalty.credit(account, 'ORDER:' + record.custom.key, points, { type: 'EARN', source: 'ORDER', orderNo: record.custom.key });
        record.custom.baseAmount = base;
        record.custom.earnedPoints = points;
        record.custom.status = 'AVAILABLE';
        record.custom.reviewReason = null;
    });
    // Separate transaction: the tier query must see this order as AVAILABLE.
    Transaction.wrap(function () { loyalty.evaluateTier(account, now); });
}

/**
 * Moves one loyalty order forward. Called by the order job.
 * @param {dw.object.CustomObject} record - LoyaltyOrder with status CREATED or PENDING
 * @param {Date} now - evaluation time
 */
function advance(record, now) {
    var order = require('dw/order/OrderMgr').getOrder(record.custom.key);
    var decision = evaluate(order, record, now);
    if (decision.action === 'WAIT') {
        if (record.custom.reviewReason !== decision.reason) {
            Transaction.wrap(function () { record.custom.reviewReason = decision.reason; });
        }
    } else if (decision.action === 'CLOSE') {
        close(record, decision.reason);
    } else if (decision.action === 'RECORD') {
        recordEarn(order);
    } else if (decision.action === 'DELIVERED') {
        Transaction.wrap(function () {
            record.custom.deliveredAt = now;
            record.custom.reviewReason = null;
        });
    } else {
        release(record, order, now);
    }
}

module.exports = {
    ADJUSTMENT_ID: ADJUSTMENT_ID,
    customerNoOf: customerNoOf,
    netProductValue: netProductValue,
    syncBasket: syncBasket,
    reserve: reserve,
    recordEarn: recordEarn,
    close: close,
    refundFailed: refundFailed,
    evaluate: evaluate,
    advance: advance
};
