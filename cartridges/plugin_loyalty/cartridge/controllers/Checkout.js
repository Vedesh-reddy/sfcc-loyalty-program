'use strict';

var server = require('server');
server.extend(module.superModule);

server.append('Begin', function (req, res, next) {
    var loyalty = require('*/cartridge/scripts/helpers/loyaltyHelper');
    var orders = require('*/cartridge/scripts/helpers/loyaltyOrderHelper');
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    if (!basket || !loyalty.enabled()) return next();
    var StringUtils = require('dw/util/StringUtils');
    var Money = require('dw/value/Money');
    var format = function (value) { return StringUtils.formatMoney(new Money(value, basket.currencyCode)); };
    var profile = req.currentCustomer.profile;
    var account = profile ? loyalty.ensureAccount(profile.customerNo) : null;
    var tier = account ? account.custom.tier || 'SILVER' : 'SILVER';
    var balance = account ? account.custom.balance || 0 : 0;
    var applied = basket.custom.loyaltyPointsApplied || 0;
    var merchandise = basket.getAdjustedMerchandizeTotalPrice(true).value + loyalty.valueOf(applied);
    var minimum = loyalty.pref('LoyaltyMinRedeemPoints');
    var maxUsable = loyalty.usable(balance, balance, merchandise);
    res.setViewData({
        loyaltyCheckout: {
            signedIn: !!account,
            tier: tier,
            balance: String(balance),
            balanceValue: format(loyalty.valueOf(balance)),
            applied: String(applied),
            appliedValue: applied ? format(loyalty.valueOf(applied)) : null,
            maxUsable: String(maxUsable),
            maxPercent: String(loyalty.pref('LoyaltyMaxRedeemPercent')),
            canRedeem: maxUsable > 0,
            needed: String(Math.max(0, minimum - balance)),
            minimum: String(minimum),
            earn: String(loyalty.pointsFor(orders.netProductValue(basket), tier))
        }
    });
    return next();
});

module.exports = server.exports();
