'use strict';

var base = module.superModule;

module.exports = Object.assign({}, base, {
    calculateTotals: function (basket) {
        base.calculateTotals(basket);
        // The points cap depends on the totals just calculated, so a changed discount needs one more pass.
        if (require('*/cartridge/scripts/helpers/loyaltyOrderHelper').syncBasket(basket)) base.calculateTotals(basket);
    }
});
