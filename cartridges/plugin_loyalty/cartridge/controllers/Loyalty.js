'use strict';

var server = require('server');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');
var csrfProtection = require('*/cartridge/scripts/middleware/csrf');
var loyalty = require('*/cartridge/scripts/helpers/loyaltyHelper');

// Login-Show return slot registered in config/oAuthRenentryRedirectEndpoints.js.
var LOGIN_RETURN = 5;
var DAY = 86400000;

/**
 * Stops the route with a 404 when the program is switched off.
 * @param {Object} req - request
 * @param {Object} res - response
 * @param {Function} next - next middleware
 * @returns {void}
 */
function requireProgram(req, res, next) {
    if (!loyalty.enabled()) {
        res.setStatusCode(404);
        res.render('error/notFound');
        this.done(req, res);
        return;
    }
    next();
}

/**
 * @param {Date} date - date to format
 * @returns {string} yyyy-MM-dd in the site time zone
 */
function day(date) {
    var StringUtils = require('dw/util/StringUtils');
    var Calendar = require('dw/util/Calendar');
    return date ? StringUtils.formatCalendar(new Calendar(date), 'yyyy-MM-dd') : '';
}

/**
 * @param {number} value - amount
 * @param {string} currencyCode - session currency
 * @returns {string} formatted money
 */
function money(value, currencyCode) {
    var StringUtils = require('dw/util/StringUtils');
    var Money = require('dw/value/Money');
    return StringUtils.formatMoney(new Money(value, currencyCode));
}

/**
 * Sets the requested points on the basket and recalculates it.
 * @param {Object} route - route context
 * @param {Object} req - request
 * @param {Object} res - response
 * @param {number} points - requested points, 0 to remove
 * @returns {boolean} true when the route should continue
 */
function request(route, req, res, points) {
    var basket = BasketMgr.getCurrentBasket();
    if (!basket || !req.currentCustomer.profile) {
        res.json({ success: false, errorMessage: Resource.msg('error.signin', 'loyalty', null) });
        route.done(req, res);
        return false;
    }
    Transaction.wrap(function () {
        basket.custom.loyaltyPointsRequested = points;
        require('*/cartridge/scripts/helpers/basketCalculationHelpers').calculateTotals(basket);
    });
    if (points && !basket.custom.loyaltyPointsApplied) {
        res.json({ success: false, errorMessage: Resource.msg('error.notusable', 'loyalty', null) });
        route.done(req, res);
        return false;
    }
    res.json({ success: true, applied: basket.custom.loyaltyPointsApplied || 0 });
    return true;
}

server.get('Show', server.middleware.https, requireProgram, function (req, res, next) {
    var currency = req.session.currency.currencyCode;
    var breadcrumbs = [{ htmlValue: Resource.msg('global.home', 'common', null), url: URLUtils.home().toString() }];
    var program = {
        earnPercent: String(loyalty.earnPercent('SILVER')),
        perUnit: String(loyalty.pref('LoyaltyPointsPerCurrencyUnit')),
        minRedeem: String(loyalty.pref('LoyaltyMinRedeemPoints')),
        maxPercent: String(loyalty.pref('LoyaltyMaxRedeemPercent')),
        months: String(loyalty.pref('LoyaltyExpiryMonths')),
        tiers: loyalty.TIERS.map(function (tier) {
            return { name: tier, percent: String(loyalty.earnPercent(tier)), threshold: money(tier === 'SILVER' ? 0 : loyalty.pref('Loyalty' + tier.charAt(0) + tier.slice(1).toLowerCase() + 'Threshold'), currency) };
        })
    };
    if (!req.currentCustomer.profile) {
        res.render('loyalty/dashboard', { program: program, loginUrl: URLUtils.https('Login-Show', 'rurl', LOGIN_RETURN).toString(), breadcrumbs: breadcrumbs });
        return next();
    }
    var customerNo = req.currentCustomer.profile.customerNo;
    var account = loyalty.ensureAccount(customerNo);
    var now = Date.now();
    var soon = loyalty.query('LoyaltyLot', 'custom.customerNo = {0} AND custom.remaining > {1} AND custom.expiresAt <= {2}',
        [customerNo, 0, new Date(now + (loyalty.pref('LoyaltyExpiryReminderDays') * DAY))], 200, 'custom.expiresAt asc');
    var tier = account.custom.tier || 'SILVER';
    var nextTier = loyalty.TIERS[loyalty.TIERS.indexOf(tier) + 1] || null;
    var nextThreshold = nextTier ? loyalty.pref('Loyalty' + nextTier.charAt(0) + nextTier.slice(1).toLowerCase() + 'Threshold') : 0;
    var spend = account.custom.spend12m || 0;
    breadcrumbs.push({ htmlValue: Resource.msg('page.title.myaccount', 'account', null), url: URLUtils.url('Account-Show').toString() });
    res.render('loyalty/dashboard', {
        program: program,
        breadcrumbs: breadcrumbs,
        account: {
            balance: String(account.custom.balance || 0),
            value: money(loyalty.valueOf(account.custom.balance || 0), currency),
            pending: String(account.custom.pending || 0),
            tier: tier,
            tierPercent: String(loyalty.earnPercent(tier)),
            spend: money(spend, currency),
            next: nextTier,
            nextGap: nextTier ? money(Math.max(0, nextThreshold - spend), currency) : null,
            progress: nextTier ? String(Math.min(100, Math.round((spend / nextThreshold) * 100))) : '100',
            canRedeem: (account.custom.balance || 0) >= loyalty.pref('LoyaltyMinRedeemPoints'),
            expiring: String(soon.reduce(function (sum, lot) { return sum + lot.custom.remaining; }, 0)),
            expiringOn: soon.length ? day(soon[0].custom.expiresAt) : null
        },
        activity: loyalty.query('LoyaltyLedger', 'custom.customerNo = {0}', [customerNo], 25, 'custom.key desc').map(function (entry) {
            return {
                date: day(entry.creationDate),
                type: entry.custom.type,
                source: entry.custom.orderNo || entry.custom.source || '',
                points: (entry.custom.points > 0 ? '+' : '') + entry.custom.points,
                positive: entry.custom.points > 0,
                balance: String(entry.custom.balanceAfter)
            };
        })
    });
    return next();
});

server.post('Apply', server.middleware.https, csrfProtection.validateAjaxRequest, requireProgram, function (req, res, next) {
    var points = parseInt(req.form.points, 10);
    if (!(points > 0)) {
        res.json({ success: false, errorMessage: Resource.msg('error.notusable', 'loyalty', null) });
        return next();
    }
    return request(this, req, res, points) ? next() : null;
});

server.post('Remove', server.middleware.https, csrfProtection.validateAjaxRequest, requireProgram, function (req, res, next) {
    return request(this, req, res, 0) ? next() : null;
});

module.exports = server.exports();
