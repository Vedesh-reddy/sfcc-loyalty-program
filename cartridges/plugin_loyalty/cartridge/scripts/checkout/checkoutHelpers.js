'use strict';

var base = module.superModule;
var Transaction = require('dw/system/Transaction');
var Logger = require('dw/system/Logger');

/**
 * @returns {Object} the loyalty order helper
 */
function orders() {
    return require('*/cartridge/scripts/helpers/loyaltyOrderHelper');
}

module.exports = Object.assign({}, base, {
    createOrder: function (basket) {
        // Read before the platform turns the basket into the order.
        var points = basket.custom.loyaltyPointsApplied || 0;
        var order = base.createOrder(basket);
        if (!order || !points) return order;
        try {
            Transaction.wrap(function () { orders().reserve(order, points); });
            return order;
        } catch (e) {
            // Balance spent elsewhere since the basket was priced: the shopper must not get the discount.
            Logger.getLogger('loyalty-program', 'loyalty-redemption').warn('Points not reserved for order {0}: {1}', order.orderNo, e.message);
            Transaction.wrap(function () { require('dw/order/OrderMgr').failOrder(order, true); });
            return null;
        }
    },
    handlePayments: function (order, orderNumber) {
        var result = base.handlePayments(order, orderNumber);
        if (result.error) orders().refundFailed(order);
        return result;
    },
    placeOrder: function (order, fraudDetectionStatus) {
        var result = base.placeOrder(order, fraudDetectionStatus);
        try {
            if (result.error) orders().refundFailed(order);
            else orders().recordEarn(order);
        } catch (e) {
            // The order outcome stands; the order job records or refunds it on its next run.
            Logger.getLogger('loyalty-program', 'loyalty-orders').error('Loyalty not updated for order {0}: {1}', order.orderNo, e.message);
        }
        return result;
    }
});
