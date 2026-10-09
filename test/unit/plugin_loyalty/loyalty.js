'use strict';

var assert = require('assert');
var harness = require('./harness');

var DAY = 86400000;

describe('Loyalty program', function () {
    var h;
    var loyalty;
    var orders;

    beforeEach(function () {
        h = harness();
        loyalty = h.load('scripts/helpers/loyaltyHelper');
        orders = h.load('scripts/helpers/loyaltyOrderHelper');
        h.customer('C1');
    });

    function lots(customerNo) {
        return h.rows('LoyaltyLot').filter(function (lot) { return lot.custom.customerNo === customerNo; });
    }
    function invariant(customerNo) {
        var remaining = lots(customerNo).reduce(function (sum, lot) { return sum + lot.custom.remaining; }, 0);
        assert.equal(loyalty.getAccount(customerNo).custom.balance, remaining, 'balance equals the sum of open lots');
    }
    function credit(customerNo, key, points, expiresAt) {
        h.transaction(function () {
            loyalty.credit(loyalty.getAccount(customerNo), key, points, { type: 'BONUS', source: 'TEST' }, expiresAt);
        });
    }

    describe('earning rules', function () {
        it('earns 5% of the net product price as points, 10 points per currency unit', function () {
            assert.equal(loyalty.pointsFor(100, 'SILVER'), 50);
            assert.equal(loyalty.pointsFor(40.99, 'SILVER'), 20);
            assert.equal(loyalty.pointsFor(100, 'GOLD'), 70);
            assert.equal(loyalty.pointsFor(100, 'PLATINUM'), 100);
            assert.equal(loyalty.valueOf(205), 20.5);
        });

        it('places customers in tiers by delivered spend', function () {
            assert.equal(loyalty.tierFor(999.99), 'SILVER');
            assert.equal(loyalty.tierFor(1000), 'GOLD');
            assert.equal(loyalty.tierFor(2500), 'PLATINUM');
        });

        it('limits redemption to the minimum, the balance and the order cap', function () {
            assert.equal(loyalty.usable(50, 90, 1000), 0, 'below the 100-point minimum');
            assert.equal(loyalty.usable(500, 300, 1000), 300, 'never more than the balance');
            assert.equal(loyalty.usable(5000, 5000, 100), 500, 'at most 50% of a 100 order = 500 points');
            assert.equal(loyalty.usable(120, 150, 1000), 120);
        });
    });

    describe('ledger', function () {
        it('opens an account once with the welcome bonus', function () {
            loyalty.ensureAccount('C1');
            loyalty.ensureAccount('C1');
            var account = loyalty.getAccount('C1');
            assert.equal(account.custom.balance, 100);
            assert.equal(account.custom.sequence, 1);
            assert.equal(h.rows('LoyaltyLedger').length, 1);
            invariant('C1');
        });

        it('credits a source only once', function () {
            loyalty.ensureAccount('C1');
            assert.equal(loyalty.award('C1', 'BIRTHDAY:C1:2026', 'BIRTHDAY', 200), true);
            assert.equal(loyalty.award('C1', 'BIRTHDAY:C1:2026', 'BIRTHDAY', 200), false);
            assert.equal(loyalty.getAccount('C1').custom.balance, 300);
        });

        it('redeems the soonest-expiring points first', function () {
            loyalty.ensureAccount('C1');
            credit('C1', 'LATE', 300, new Date(Date.now() + (300 * DAY)));
            credit('C1', 'SOON', 100, new Date(Date.now() + (10 * DAY)));
            var consumed = loyalty.debit(loyalty.getAccount('C1'), 150, '0001');
            assert.deepEqual(consumed, [{ key: 'SOON', points: 100 }, { key: 'LATE', points: 50 }]);
            assert.equal(h.db['LoyaltyLedger:C1:000004'].custom.balanceAfter, 350);
            invariant('C1');
        });

        it('refuses to redeem more than the balance and changes nothing', function () {
            loyalty.ensureAccount('C1');
            assert.throws(function () {
                h.transaction(function () { loyalty.debit(loyalty.getAccount('C1'), 101, '0001'); });
            }, /LOYALTY_INSUFFICIENT_POINTS/);
            assert.equal(loyalty.getAccount('C1').custom.balance, 100);
            assert.equal(h.db['LoyaltyLot:WELCOME:C1'].custom.remaining, 100);
        });

        it('serializes concurrent balance changes through the ledger key', function () {
            loyalty.ensureAccount('C1');
            var account = loyalty.getAccount('C1');
            // A second writer that read the same sequence collides on the next ledger key.
            h.db['LoyaltyLedger:C1:000002'] = { type: 'LoyaltyLedger', custom: { key: 'C1:000002' } };
            assert.throws(function () { loyalty.post(account, { type: 'BONUS', points: 10 }); }, /UNIQUE_CONSTRAINT/);
        });

        it('expires what is left of a lot', function () {
            loyalty.ensureAccount('C1');
            var lot = h.db['LoyaltyLot:WELCOME:C1'];
            loyalty.expire(lot);
            assert.equal(lot.custom.remaining, 0);
            assert.equal(loyalty.getAccount('C1').custom.balance, 0);
            invariant('C1');
        });
    });

    describe('checkout', function () {
        beforeEach(function () {
            loyalty.ensureAccount('C1');
            credit('C1', 'EXTRA', 400);
        });

        it('applies requested points as an order discount within the cap', function () {
            var basket = h.basket('C1', [h.line(60)]);
            basket.custom.loyaltyPointsRequested = 500;
            assert.equal(orders.syncBasket(basket), true);
            assert.equal(basket.custom.loyaltyPointsApplied, 300, '50% of 60 = 30 = 300 points');
            assert.equal(basket.getPriceAdjustmentByPromotionID('loyalty-points').priceValue, -30);
            assert.equal(orders.syncBasket(basket), false, 'stable on recalculation');
            basket.custom.loyaltyPointsRequested = 0;
            assert.equal(orders.syncBasket(basket), true);
            assert.equal(basket.getPriceAdjustmentByPromotionID('loyalty-points'), null);
        });

        it('gives guests no discount', function () {
            var basket = h.basket(null, [h.line(60)]);
            basket.custom.loyaltyPointsRequested = 200;
            orders.syncBasket(basket);
            assert.equal(basket.custom.loyaltyPointsApplied, 0);
        });

        it('reserves points at order creation and refunds them once if the order fails', function () {
            var order = h.order('0001', 'C1', [h.line(60)]);
            orders.reserve(order, 300);
            assert.equal(loyalty.getAccount('C1').custom.balance, 200);
            assert.equal(order.custom.loyaltyPointsRedeemed, 300);
            orders.refundFailed(order);
            orders.refundFailed(order);
            assert.equal(loyalty.getAccount('C1').custom.balance, 500);
            assert.equal(h.db['LoyaltyOrder:0001'].custom.status, 'FAILED');
            invariant('C1');
        });
    });

    describe('earning lifecycle', function () {
        var order;
        var record;
        beforeEach(function () {
            order = h.order('0001', 'C1', [h.line(400), h.line(200)]);
            orders.recordEarn(order);
            record = h.db['LoyaltyOrder:0001'];
        });

        it('records pending points at 5% of the net product value', function () {
            assert.equal(record.custom.status, 'PENDING');
            assert.equal(record.custom.pendingPoints, 300);
            assert.equal(loyalty.getAccount('C1').custom.pending, 300);
            orders.recordEarn(order);
            assert.equal(loyalty.getAccount('C1').custom.pending, 300, 'recorded once');
        });

        it('waits for payment and delivery, then the return window', function () {
            var now = new Date();
            h.order('0001', 'C1', [h.line(600)], { paymentStatus: { value: h.Order.PAYMENT_STATUS_NOTPAID } });
            orders.advance(record, now);
            assert.equal(record.custom.reviewReason, 'NOT_PAID');
            h.order('0001', 'C1', [h.line(600)], { shippingStatus: { value: 0 }, shipments: h.array([{ shippingStatus: { value: 2 } }]) });
            orders.advance(record, now);
            assert.ok(record.custom.deliveredAt, 'every shipment shipped counts as delivered');
            orders.advance(record, new Date(now.getTime() + DAY));
            assert.equal(record.custom.reviewReason, 'RETURN_WINDOW');
            orders.advance(record, new Date(now.getTime() + (8 * DAY)));
            assert.equal(record.custom.status, 'AVAILABLE');
            assert.equal(loyalty.getAccount('C1').custom.balance, 400, 'welcome 100 + 300 earned');
            assert.equal(loyalty.getAccount('C1').custom.pending, 0);
            invariant('C1');
        });

        it('earns nothing on a cancelled order and refunds redeemed points', function () {
            credit('C1', 'EXTRA', 200);
            var placed = h.order('0002', 'C1', [h.line(100)]);
            orders.reserve(placed, 200);
            orders.recordEarn(placed);
            h.order('0002', 'C1', [h.line(100)], { status: { value: h.Order.ORDER_STATUS_CANCELLED } });
            orders.advance(h.db['LoyaltyOrder:0002'], new Date());
            assert.equal(h.db['LoyaltyOrder:0002'].custom.status, 'CANCELLED');
            assert.equal(loyalty.getAccount('C1').custom.balance, 300);
            assert.equal(loyalty.getAccount('C1').custom.pending, 300, 'only order 0001 still pending');
            invariant('C1');
        });

        it('leaves returned items out of the earned points, ignoring cancelled returns', function () {
            var returned = h.line(400);
            var cancelledReturn = { lineItem: h.line(200), authorizedQuantity: { value: 1 }, status: { value: 'CANCELLED' } };
            h.order('0001', 'C1', [returned, h.line(200)], { returnCaseItems: h.array([{ lineItem: returned, authorizedQuantity: { value: 1 } }, cancelledReturn]) });
            record.custom.deliveredAt = new Date(Date.now() - (10 * DAY));
            orders.advance(record, new Date());
            assert.equal(record.custom.earnedPoints, 100, '5% of the 200 kept');
        });

        it('upgrades the tier from delivered spend', function () {
            h.preferences.LoyaltyGoldThreshold = 500;
            record.custom.deliveredAt = new Date(Date.now() - (10 * DAY));
            orders.advance(record, new Date());
            assert.equal(loyalty.getAccount('C1').custom.tier, 'GOLD');
            h.order('0003', 'C1', [h.line(100)]);
            orders.recordEarn(h.order('0003', 'C1', [h.line(100)]));
            assert.equal(h.db['LoyaltyOrder:0003'].custom.pendingPoints, 70, 'Gold earns 7%');
        });
    });

    describe('maintenance job', function () {
        it('expires lots, reminds once, awards birthday and profile bonuses', function () {
            var today = new Date();
            h.customer('C1', {
                birthday: new Date(Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())),
                lastName: 'Rao',
                phoneMobile: '9876543210',
                addressBook: { addresses: h.array([{}]) }
            });
            loyalty.ensureAccount('C1');
            credit('C1', 'OLD', 50, new Date(Date.now() - DAY));
            credit('C1', 'SOON', 80, new Date(Date.now() + (5 * DAY)));
            var job = h.load('scripts/jobs/maintainLoyalty');
            loyalty = h.load('scripts/helpers/loyaltyHelper');
            assert.equal(job.execute().code, 'OK');
            job.execute();
            assert.equal(h.db['LoyaltyLot:OLD'].custom.remaining, 0);
            assert.equal(h.emails.length, 1, 'one reminder');
            assert.equal(h.emails[0].context.points, 80);
            assert.ok(h.db['LoyaltyLot:BIRTHDAY:C1:' + today.getUTCFullYear()]);
            assert.ok(h.db['LoyaltyLot:PROFILE:C1']);
            assert.equal(loyalty.getAccount('C1').custom.balance, 100 + 80 + 200 + 50);
            invariant('C1');
        });
    });
});
