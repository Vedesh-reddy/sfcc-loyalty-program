'use strict';

// Small in-memory Script API double for the loyalty helpers. It checks domain rules, not platform isolation.
var Module = require('module');
var path = require('path');

var root = path.resolve(__dirname, '../../../cartridges/plugin_loyalty/cartridge');
var active = {};
var original = Module._load; // eslint-disable-line no-underscore-dangle

// Only cartridge modules are redirected, so other suites in the same mocha run are unaffected.
Module._load = function (request, parent, isMain) { // eslint-disable-line no-underscore-dangle
    var ours = parent && parent.filename && parent.filename.indexOf(root) === 0;
    if (ours && active[request]) return active[request];
    if (ours && request.indexOf('*/cartridge/') === 0) return original.call(this, path.join(root, request.slice(12)), parent, isMain);
    return original.call(this, request, parent, isMain);
};

function array(values) {
    return {
        toArray: function () { return values.slice(); },
        size: function () { return values.length; }
    };
}

function value(row, field) {
    return field.indexOf('custom.') === 0 ? row.custom[field.slice(7)] : row[field];
}

function compare(a, b) {
    var x = a instanceof Date ? a.getTime() : a;
    var y = b instanceof Date ? b.getTime() : b;
    if (x === y) return 0;
    return x < y ? -1 : 1;
}

function matches(row, clause, args) {
    var m = clause.trim().match(/^([\w.]+)\s*(>=|<=|>|<|=)\s*(\{(\d+)\}|NULL)$/);
    var actual = value(row, m[1]);
    if (m[3] === 'NULL') return actual === null || actual === undefined;
    var expected = args[Number(m[4])];
    if (actual === null || actual === undefined) return false;
    var c = compare(actual, expected);
    return { '=': c === 0, '>': c > 0, '>=': c >= 0, '<': c < 0, '<=': c <= 0 }[m[2]];
}

function harness() {
    var db = {};
    var preferences = { LoyaltyEnabled: true, customerServiceEmail: 'shop@example.test' };
    var customers = {};
    var orders = {};
    var emails = [];
    var clock = 0;

    function transactionWrap(fn) {
        var snapshot = {};
        Object.keys(db).forEach(function (id) { snapshot[id] = Object.assign({}, db[id].custom); });
        try {
            return fn();
        } catch (e) {
            Object.keys(db).forEach(function (id) {
                if (!(id in snapshot)) delete db[id];
                else db[id].custom = snapshot[id];
            });
            throw e;
        }
    }
    function rows(type) {
        return Object.keys(db).map(function (id) { return db[id]; }).filter(function (row) { return row.type === type; });
    }
    function iterator(list) {
        var i = 0;
        return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; }, close: function () {} };
    }
    var customObjectMgr = {
        getCustomObject: function (type, key) { return db[type + ':' + key] || null; },
        createCustomObject: function (type, key) {
            var id = type + ':' + key;
            if (db[id]) throw new Error('UNIQUE_CONSTRAINT');
            clock += 1;
            db[id] = { type: type, UUID: id, custom: { key: key }, creationDate: new Date(Date.UTC(2026, 0, 1) + clock), lastModified: new Date() };
            return db[id];
        },
        getAllCustomObjects: function (type) { return iterator(rows(type)); },
        queryCustomObjects: function (type, condition, sort) {
            var args = Array.prototype.slice.call(arguments, 3);
            var or = condition.indexOf(' OR ') !== -1;
            var clauses = condition.split(or ? ' OR ' : ' AND ');
            var list = rows(type).filter(function (row) {
                return or ? clauses.some(function (c) { return matches(row, c, args); }) : clauses.every(function (c) { return matches(row, c, args); });
            });
            var parts = sort.split(' ');
            list.sort(function (a, b) { return compare(value(a, parts[0]), value(b, parts[0])) * (parts[1] === 'desc' ? -1 : 1); });
            return iterator(list);
        }
    };
    var Order = { ORDER_STATUS_CREATED: 0, ORDER_STATUS_NEW: 3, ORDER_STATUS_CANCELLED: 6, ORDER_STATUS_FAILED: 8, PAYMENT_STATUS_PAID: 2, PAYMENT_STATUS_NOTPAID: 0, SHIPPING_STATUS_SHIPPED: 2, SHIPPING_STATUS_NOTSHIPPED: 0 };
    var stubs = {
        'dw/object/CustomObjectMgr': customObjectMgr,
        'dw/system/Transaction': { wrap: transactionWrap },
        'dw/system/Site': { current: { getCustomPreferenceValue: function (name) { return name in preferences ? preferences[name] : null; } } },
        'dw/system/Logger': { getLogger: function () { return { warn: function () {}, info: function () {}, error: function () {} }; } },
        'dw/system/Status': function (status, code) { this.status = status; this.code = code; },
        'dw/customer/CustomerMgr': { getCustomerByCustomerNumber: function (no) { return customers[no] || null; } },
        'dw/order/Order': Order,
        'dw/order/Shipment': { SHIPPING_STATUS_SHIPPED: 2, SHIPPING_STATUS_NOTSHIPPED: 0 },
        'dw/order/OrderMgr': { getOrder: function (no) { return orders[no] || null; } },
        'dw/web/Resource': { msg: function (key) { return key; }, msgf: function (key) { return key; } },
        'dw/web/URLUtils': { https: function () { return 'https://example.test/points'; } },
        '*/cartridge/scripts/helpers/emailHelpers': { send: function (obj, template, context) { emails.push({ to: obj.to, template: template, context: context }); } }
    };
    stubs['dw/system/Status'].OK = 0;
    stubs['dw/system/Status'].ERROR = 1;

    function load(relative) {
        Object.keys(require.cache).forEach(function (key) { if (key.indexOf(root) === 0) delete require.cache[key]; });
        active = stubs;
        return require(path.join(root, relative));
    }

    function line(price, quantity) {
        return { quantityValue: quantity || 1, proratedPrice: { value: price } };
    }

    function container(customerNo, lines) {
        var adjustments = {};
        var c = {
            custom: {},
            currencyCode: 'USD',
            customer: customerNo ? { registered: true, profile: { customerNo: customerNo } } : { registered: false },
            productLineItems: array(lines),
            getPriceAdjustmentByPromotionID: function (id) { return adjustments[id] || null; },
            createPriceAdjustment: function (id) {
                adjustments[id] = { priceValue: 0, setPriceValue: function (v) { this.priceValue = v; }, setLineItemText: function () {} };
                return adjustments[id];
            },
            removePriceAdjustment: function (a) { Object.keys(adjustments).forEach(function (k) { if (adjustments[k] === a) delete adjustments[k]; }); },
            getAdjustedMerchandizeTotalPrice: function () {
                var total = lines.reduce(function (sum, l) { return sum + l.proratedPrice.value; }, 0);
                var adjustment = adjustments['loyalty-points'];
                return { value: total + (adjustment ? adjustment.priceValue : 0) };
            }
        };
        return c;
    }

    function order(no, customerNo, lines, fields) {
        orders[no] = Object.assign(container(customerNo, lines), {
            orderNo: no,
            customerNo: customerNo,
            status: { value: Order.ORDER_STATUS_NEW },
            paymentStatus: { value: Order.PAYMENT_STATUS_PAID },
            shippingStatus: { value: Order.SHIPPING_STATUS_SHIPPED },
            shipments: array([]),
            returnCaseItems: array([])
        }, fields);
        return orders[no];
    }

    return {
        db: db,
        Order: Order,
        preferences: preferences,
        emails: emails,
        array: array,
        load: load,
        line: line,
        basket: container,
        order: order,
        rows: rows,
        transaction: transactionWrap,
        customer: function (no, profile) {
            customers[no] = { profile: Object.assign({ customerNo: no, email: no + '@example.test', firstName: 'Asha', addressBook: { addresses: array([]) } }, profile) };
        }
    };
}

module.exports = harness;
