'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var Site = require('dw/system/Site');

var DAY = 86400000;
var TIERS = ['SILVER', 'GOLD', 'PLATINUM'];
var defaults = {
    LoyaltyPointsPerCurrencyUnit: 10,
    LoyaltyMinRedeemPoints: 100,
    LoyaltyMaxRedeemPercent: 50,
    LoyaltyEarnPercentSilver: 5,
    LoyaltyEarnPercentGold: 7,
    LoyaltyEarnPercentPlatinum: 10,
    LoyaltyGoldThreshold: 1000,
    LoyaltyPlatinumThreshold: 2500,
    LoyaltyReturnWindowDays: 7,
    LoyaltyExpiryMonths: 12,
    LoyaltyExpiryReminderDays: 30,
    LoyaltyWelcomeBonus: 100,
    LoyaltyBirthdayBonus: 200,
    LoyaltyProfileBonus: 50,
    LoyaltyReviewBonus: 50
};

/**
 * @param {string} name - site preference ID
 * @returns {number} preference value, or the documented default when unset
 */
function pref(name) {
    var value = Site.current.getCustomPreferenceValue(name);
    return value === null || value === undefined ? defaults[name] : Number(value);
}

/**
 * @returns {boolean} whether the program is switched on for the current site
 */
function enabled() {
    return Site.current.getCustomPreferenceValue('LoyaltyEnabled') === true;
}

/**
 * @param {string} tier - SILVER, GOLD or PLATINUM
 * @returns {number} value earned as points, in percent of the net product price
 */
function earnPercent(tier) {
    return pref('LoyaltyEarnPercent' + tier.charAt(0) + tier.slice(1).toLowerCase());
}

/**
 * @param {number} spend - delivered spend in the last 12 months
 * @returns {string} the tier that spend qualifies for
 */
function tierFor(spend) {
    if (spend >= pref('LoyaltyPlatinumThreshold')) return 'PLATINUM';
    if (spend >= pref('LoyaltyGoldThreshold')) return 'GOLD';
    return 'SILVER';
}

/**
 * @param {number} value - money value in currency units
 * @param {string} tier - tier whose rate applies
 * @returns {number} whole points earned on that value
 */
function pointsFor(value, tier) {
    // Integer cents avoid binary rounding in the percentage.
    return Math.floor((Math.round(value * 100) * earnPercent(tier) * pref('LoyaltyPointsPerCurrencyUnit')) / 10000);
}

/**
 * @param {number} points - points
 * @returns {number} their value in currency units
 */
function valueOf(points) {
    return points / pref('LoyaltyPointsPerCurrencyUnit');
}

/**
 * Reads a bounded page of custom objects and always closes the iterator.
 * @param {string} type - custom object type
 * @param {string} condition - query condition
 * @param {Array} args - query arguments
 * @param {number} limit - maximum results
 * @param {string} [sort] - sort string
 * @returns {Array} custom objects
 */
function query(type, condition, args, limit, sort) {
    var iterator = CustomObjectMgr.queryCustomObjects.apply(CustomObjectMgr, [type, condition, sort || 'creationDate desc'].concat(args));
    var result = [];
    try {
        while (iterator.hasNext() && result.length < limit) result.push(iterator.next());
    } finally {
        iterator.close();
    }
    return result;
}

/**
 * @param {string} customerNo - customer number
 * @returns {dw.object.CustomObject|null} the account
 */
function getAccount(customerNo) {
    return customerNo ? CustomObjectMgr.getCustomObject('LoyaltyAccount', customerNo) : null;
}

/**
 * Appends a ledger entry and moves the balance. Caller owns the transaction.
 * The entry key is customerNo plus the next sequence number, so two concurrent writers
 * for one customer collide on the key and one transaction rolls back instead of losing an update.
 * @param {dw.object.CustomObject} account - LoyaltyAccount
 * @param {Object} entry - { type, points, orderNo, source, detail }
 * @returns {dw.object.CustomObject} the ledger entry
 */
function post(account, entry) {
    var sequence = (account.custom.sequence || 0) + 1;
    var ledger = CustomObjectMgr.createCustomObject('LoyaltyLedger', account.custom.key + ':' + ('00000' + sequence).slice(-6));
    account.custom.sequence = sequence;
    account.custom.balance = (account.custom.balance || 0) + entry.points;
    if (account.custom.balance < 0) throw new Error('LOYALTY_NEGATIVE_BALANCE');
    if (entry.type === 'EARN' || entry.type === 'BONUS') account.custom.lifetimeEarned = (account.custom.lifetimeEarned || 0) + entry.points;
    if (entry.type === 'REDEEM') account.custom.lifetimeRedeemed = (account.custom.lifetimeRedeemed || 0) - entry.points;
    ledger.custom.customerNo = account.custom.key;
    ledger.custom.type = entry.type;
    ledger.custom.points = entry.points;
    ledger.custom.balanceAfter = account.custom.balance;
    ledger.custom.orderNo = entry.orderNo || null;
    ledger.custom.source = entry.source || null;
    ledger.custom.detail = entry.detail || null;
    return ledger;
}

/**
 * Credits a lot of points. Caller owns the transaction. The lot key is the credit
 * source (ORDER:no, BIRTHDAY:no:year, ...), so crediting the same source twice fails.
 * @param {dw.object.CustomObject} account - LoyaltyAccount
 * @param {string} key - unique credit source
 * @param {number} points - points to credit
 * @param {Object} entry - { type, source, orderNo }
 * @param {Date} [expiresAt] - expiry, defaults to LoyaltyExpiryMonths from now
 * @returns {dw.object.CustomObject} the lot
 */
function credit(account, key, points, entry, expiresAt) {
    var lot = CustomObjectMgr.createCustomObject('LoyaltyLot', key);
    var expiry = expiresAt || new Date();
    if (!expiresAt) expiry.setUTCMonth(expiry.getUTCMonth() + pref('LoyaltyExpiryMonths'));
    lot.custom.customerNo = account.custom.key;
    lot.custom.source = entry.source;
    lot.custom.points = points;
    lot.custom.remaining = points;
    lot.custom.expiresAt = expiry;
    post(account, { type: entry.type, points: points, orderNo: entry.orderNo, source: key });
    return lot;
}

/**
 * Consumes points oldest-expiry first. Caller owns the transaction.
 * @param {dw.object.CustomObject} account - LoyaltyAccount
 * @param {number} points - points to redeem
 * @param {string} orderNo - redeeming order
 * @returns {Array} consumed lots as { key, points }
 */
function debit(account, points, orderNo) {
    var now = new Date();
    var lots = query('LoyaltyLot', 'custom.customerNo = {0} AND custom.remaining > {1} AND custom.expiresAt > {2}',
        [account.custom.key, 0, now], 500, 'custom.expiresAt asc');
    var open = points;
    var consumed = [];
    lots.forEach(function (lot) {
        if (!open) return;
        var take = Math.min(open, lot.custom.remaining);
        lot.custom.remaining -= take;
        open -= take;
        consumed.push({ key: lot.custom.key, points: take });
    });
    if (open) throw new Error('LOYALTY_INSUFFICIENT_POINTS');
    post(account, { type: 'REDEEM', points: -points, orderNo: orderNo, detail: JSON.stringify(consumed) });
    return consumed;
}

/**
 * Returns redeemed points to the lots they came from. Caller owns the transaction.
 * @param {dw.object.CustomObject} account - LoyaltyAccount
 * @param {Array} consumed - lots as { key, points }
 * @param {string} orderNo - order whose redemption is refunded
 */
function restore(account, consumed, orderNo) {
    var points = 0;
    consumed.forEach(function (part) {
        var lot = CustomObjectMgr.getCustomObject('LoyaltyLot', part.key);
        if (lot) lot.custom.remaining += part.points;
        points += part.points;
    });
    // Restored points keep their original expiry; the maintenance job expires them if it has passed.
    if (points) post(account, { type: 'REFUND', points: points, orderNo: orderNo, detail: JSON.stringify(consumed) });
}

/**
 * Expires what is left of a lot. Caller owns the transaction.
 * @param {dw.object.CustomObject} lot - LoyaltyLot past its expiry
 */
function expire(lot) {
    var remaining = lot.custom.remaining;
    if (!remaining) return;
    lot.custom.remaining = 0;
    post(getAccount(lot.custom.customerNo), { type: 'EXPIRE', points: -remaining, source: lot.custom.key });
}

/**
 * @param {string} customerNo - customer number
 * @param {Date} now - evaluation time
 * @returns {number} net product value of orders delivered in the last 12 months
 */
function spendFor(customerNo, now) {
    var since = new Date(now.getTime() - (365 * DAY));
    return query('LoyaltyOrder', 'custom.customerNo = {0} AND custom.status = {1} AND custom.deliveredAt >= {2}',
        [customerNo, 'AVAILABLE', since], 1000).reduce(function (sum, record) {
        return sum + (record.custom.baseAmount || 0);
    }, 0);
}

/**
 * Re-evaluates an account's rolling spend and tier. Caller owns the transaction.
 * @param {dw.object.CustomObject} account - LoyaltyAccount
 * @param {Date} now - evaluation time
 */
function evaluateTier(account, now) {
    var spend = spendFor(account.custom.key, now);
    account.custom.spend12m = spend;
    account.custom.tier = tierFor(spend);
    account.custom.tierEvaluatedAt = now;
}

/**
 * Credits a one-off bonus. Safe to call repeatedly: the lot key makes it happen once.
 * @param {string} customerNo - customer number
 * @param {string} key - unique bonus key, e.g. BIRTHDAY:00012345:2026
 * @param {string} source - WELCOME, BIRTHDAY, PROFILE or REVIEW
 * @param {number} points - bonus points
 * @returns {boolean} true when credited now
 */
function award(customerNo, key, source, points) {
    if (!points || CustomObjectMgr.getCustomObject('LoyaltyLot', key)) return false;
    try {
        Transaction.wrap(function () {
            credit(getAccount(customerNo), key, points, { type: 'BONUS', source: source });
        });
        return true;
    } catch (e) {
        // A concurrent award of the same key, or a concurrent balance change; the next run retries.
        require('dw/system/Logger').getLogger('loyalty-program', 'loyalty-bonus').warn('Bonus {0} not credited: {1}', key, e.message);
        return false;
    }
}

/**
 * Returns the customer's account, opening it (with the welcome bonus) on first use.
 * @param {string} customerNo - registered customer number
 * @returns {dw.object.CustomObject} the account
 */
function ensureAccount(customerNo) {
    var account = getAccount(customerNo);
    if (!account) {
        try {
            Transaction.wrap(function () {
                account = CustomObjectMgr.createCustomObject('LoyaltyAccount', customerNo);
                account.custom.balance = 0;
                account.custom.pending = 0;
                account.custom.tier = 'SILVER';
                account.custom.sequence = 0;
            });
        } catch (e) {
            // Opened concurrently by another request.
            account = getAccount(customerNo);
        }
    }
    award(customerNo, 'WELCOME:' + customerNo, 'WELCOME', pref('LoyaltyWelcomeBonus'));
    return getAccount(customerNo);
}

/**
 * Works out how many requested points a basket can use.
 * Rules: minimum balance, never more than the balance, and at most LoyaltyMaxRedeemPercent
 * of the merchandise total after other discounts.
 * @param {number} requested - points the shopper asked to use
 * @param {number} balance - available points
 * @param {number} merchandise - merchandise total after discounts, before points
 * @returns {number} points that can be applied
 */
function usable(requested, balance, merchandise) {
    if (!requested || balance < pref('LoyaltyMinRedeemPoints')) return 0;
    var cap = Math.floor((Math.round(merchandise * 100) * pref('LoyaltyMaxRedeemPercent') * pref('LoyaltyPointsPerCurrencyUnit')) / 10000);
    return Math.max(0, Math.min(requested, balance, cap));
}

module.exports = {
    TIERS: TIERS,
    pref: pref,
    enabled: enabled,
    earnPercent: earnPercent,
    tierFor: tierFor,
    pointsFor: pointsFor,
    valueOf: valueOf,
    query: query,
    getAccount: getAccount,
    ensureAccount: ensureAccount,
    post: post,
    credit: credit,
    debit: debit,
    restore: restore,
    expire: expire,
    spendFor: spendFor,
    evaluateTier: evaluateTier,
    award: award,
    usable: usable
};
