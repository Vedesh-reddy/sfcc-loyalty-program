'use strict';

var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var loyalty = require('*/cartridge/scripts/helpers/loyaltyHelper');
var orders = require('*/cartridge/scripts/helpers/loyaltyOrderHelper');

/**
 * Releases earned points after delivery and the return window, and refunds the
 * points of orders that failed or were cancelled.
 * @returns {dw.system.Status} OK, or ERROR when any order failed and needs a retry
 */
function execute() {
    var logger = Logger.getLogger('loyalty-program', 'loyalty-orders');
    var now = new Date();
    var failures = 0;
    // Oldest first, bounded per run; the 30-minute schedule drains any backlog.
    loyalty.query('LoyaltyOrder', 'custom.status = {0} OR custom.status = {1}', ['CREATED', 'PENDING'], 500, 'creationDate asc').forEach(function (record) {
        try {
            orders.advance(record, now);
        } catch (e) {
            failures += 1;
            logger.error('Loyalty processing failed for order {0}: {1}', record.custom.key, e.message);
        }
    });
    return failures ? new Status(Status.ERROR, 'ERROR', failures + ' orders failed') : new Status(Status.OK, 'OK');
}

module.exports = { execute: execute };
