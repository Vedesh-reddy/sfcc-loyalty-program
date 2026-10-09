'use strict';

var server = require('server');
server.extend(module.superModule);

server.append('Confirm', function (req, res, next) {
    var viewData = res.getViewData();
    var orderNo = viewData.order ? viewData.order.orderNumber : null;
    var record = orderNo ? require('dw/object/CustomObjectMgr').getCustomObject('LoyaltyOrder', orderNo) : null;
    if (record && require('*/cartridge/scripts/helpers/loyaltyHelper').enabled()) {
        res.setViewData({
            loyaltyConfirmation: {
                pending: String(record.custom.pendingPoints || 0),
                redeemed: String(record.custom.redeemedPoints || 0)
            }
        });
    }
    next();
});

module.exports = server.exports();
