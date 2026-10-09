'use strict';

var server = require('server');
server.extend(module.superModule);

// Gives a clear message when the balance changed since the points were applied; createOrder enforces it again atomically.
server.prepend('PlaceOrder', function (req, res, next) {
    var basket = require('dw/order/BasketMgr').getCurrentBasket();
    var applied = basket ? basket.custom.loyaltyPointsApplied || 0 : 0;
    if (!applied) return next();
    var loyalty = require('*/cartridge/scripts/helpers/loyaltyHelper');
    var profile = req.currentCustomer.profile;
    var account = profile ? loyalty.getAccount(profile.customerNo) : null;
    if (loyalty.enabled() && account && account.custom.balance >= applied) return next();
    res.json({ error: true, errorMessage: require('dw/web/Resource').msg('error.balance.changed', 'loyalty', null) });
    this.done(req, res);
    return null;
});

module.exports = server.exports();
