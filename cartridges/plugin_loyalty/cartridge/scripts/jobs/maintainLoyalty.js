'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');
var loyalty = require('*/cartridge/scripts/helpers/loyaltyHelper');

var DAY = 86400000;

/**
 * Expires lots past their date, oldest first.
 * @param {Date} now - run time
 * @param {Function} fail - failure counter
 */
function expireLots(now, fail) {
    loyalty.query('LoyaltyLot', 'custom.remaining > {0} AND custom.expiresAt <= {1}', [0, now], 2000, 'custom.expiresAt asc').forEach(function (lot) {
        try {
            Transaction.wrap(function () { loyalty.expire(lot); });
        } catch (e) {
            fail('expire ' + lot.custom.key, e);
        }
    });
}

/**
 * Sends one reminder per customer for points expiring within the reminder window.
 * @param {Date} now - run time
 * @param {Function} fail - failure counter
 */
function remind(now, fail) {
    var until = new Date(now.getTime() + (loyalty.pref('LoyaltyExpiryReminderDays') * DAY));
    var byCustomer = {};
    loyalty.query('LoyaltyLot', 'custom.remaining > {0} AND custom.expiresAt <= {1} AND custom.reminderSentAt = NULL', [0, until], 2000, 'custom.expiresAt asc')
        .forEach(function (lot) {
            (byCustomer[lot.custom.customerNo] = byCustomer[lot.custom.customerNo] || []).push(lot);
        });
    Object.keys(byCustomer).forEach(function (customerNo) {
        var lots = byCustomer[customerNo];
        try {
            var customer = require('dw/customer/CustomerMgr').getCustomerByCustomerNumber(customerNo);
            if (!customer || !customer.profile || !customer.profile.email) return;
            var points = lots.reduce(function (sum, lot) { return sum + lot.custom.remaining; }, 0);
            require('*/cartridge/scripts/helpers/emailHelpers').send({
                to: customer.profile.email,
                from: require('dw/system/Site').current.getCustomPreferenceValue('customerServiceEmail') || 'no-reply@salesforce.com',
                subject: require('dw/web/Resource').msgf('email.expiring.subject', 'loyalty', null, points)
            }, 'loyalty/email/expiring', {
                firstName: customer.profile.firstName,
                points: points,
                expiresAt: lots[0].custom.expiresAt,
                dashboardUrl: require('dw/web/URLUtils').https('Loyalty-Show').toString()
            });
            Transaction.wrap(function () {
                lots.forEach(function (lot) { lot.custom.reminderSentAt = now; });
            });
        } catch (e) {
            fail('remind ' + customerNo, e);
        }
    });
}

/**
 * @param {dw.customer.Profile} profile - customer profile
 * @returns {boolean} true when name, phone, birthday and an address are present
 */
function profileComplete(profile) {
    return !!(profile.firstName && profile.lastName && (profile.phoneHome || profile.phoneMobile) && profile.birthday
        && profile.addressBook.addresses.size() > 0);
}

/**
 * Re-evaluates one account's tier and awards its birthday and profile bonuses.
 * @param {dw.object.CustomObject} account - LoyaltyAccount
 * @param {Date} now - run time
 */
function reviewAccount(account, now) {
    var customerNo = account.custom.key;
    // Downgrades happen here when old orders leave the 12-month window.
    var spend = loyalty.spendFor(customerNo, now);
    if (spend !== account.custom.spend12m || loyalty.tierFor(spend) !== account.custom.tier) {
        Transaction.wrap(function () { loyalty.evaluateTier(account, now); });
    }
    var customer = require('dw/customer/CustomerMgr').getCustomerByCustomerNumber(customerNo);
    var profile = customer ? customer.profile : null;
    if (!profile) return;
    var birthday = profile.birthday;
    if (birthday && birthday.getUTCMonth() === now.getUTCMonth() && birthday.getUTCDate() === now.getUTCDate()) {
        loyalty.award(customerNo, 'BIRTHDAY:' + customerNo + ':' + now.getUTCFullYear(), 'BIRTHDAY', loyalty.pref('LoyaltyBirthdayBonus'));
    }
    if (profileComplete(profile)) loyalty.award(customerNo, 'PROFILE:' + customerNo, 'PROFILE', loyalty.pref('LoyaltyProfileBonus'));
}

/**
 * Reviews every account, streaming so the job stays within memory.
 * @param {Date} now - run time
 * @param {Function} fail - failure counter
 */
function reviewAccounts(now, fail) {
    var iterator = CustomObjectMgr.getAllCustomObjects('LoyaltyAccount');
    try {
        while (iterator.hasNext()) {
            var account = iterator.next();
            try {
                reviewAccount(account, now);
            } catch (e) {
                fail('account ' + account.custom.key, e);
            }
        }
    } finally {
        iterator.close();
    }
}

/**
 * Awards points for reviews approved in the last two days, when plugin_productreviews is installed.
 * @param {Date} now - run time
 * @param {Function} fail - failure counter
 */
function rewardReviews(now, fail) {
    var points = loyalty.pref('LoyaltyReviewBonus');
    if (!points) return;
    var reviews;
    try {
        reviews = loyalty.query('ProductReview', 'custom.status = {0} AND lastModified >= {1}', ['approved', new Date(now.getTime() - (2 * DAY))], 2000);
    } catch (e) {
        // No ProductReview type on this site: the review bonus is off.
        return;
    }
    reviews.forEach(function (review) {
        var customerNo = review.custom.customerNo;
        try {
            if (customerNo && loyalty.getAccount(customerNo)) loyalty.award(customerNo, 'REVIEW:' + review.UUID, 'REVIEW', points);
        } catch (e) {
            fail('review ' + review.UUID, e);
        }
    });
}

/**
 * Daily upkeep: expiry, reminders, tiers and bonuses.
 * @returns {dw.system.Status} OK, or ERROR when any record failed and needs a retry
 */
function execute() {
    var logger = Logger.getLogger('loyalty-program', 'loyalty-maintenance');
    var now = new Date();
    var failures = 0;
    var fail = function (what, e) {
        failures += 1;
        logger.error('Loyalty maintenance failed for {0}: {1}', what, e.message);
    };
    expireLots(now, fail);
    remind(now, fail);
    reviewAccounts(now, fail);
    rewardReviews(now, fail);
    return failures ? new Status(Status.ERROR, 'ERROR', failures + ' records failed') : new Status(Status.OK, 'OK');
}

module.exports = { execute: execute, profileComplete: profileComplete };
