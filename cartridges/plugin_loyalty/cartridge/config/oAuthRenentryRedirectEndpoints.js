'use strict';

// Slot 5 returns shoppers to the loyalty page after login; 3 and 4 belong to plugin_productreviews and plugin_affiliateproduct.
var endpoints = {};
Object.keys(module.superModule).forEach(function (key) {
    endpoints[key] = module.superModule[key];
});
endpoints[5] = 'Loyalty-Show';
module.exports = endpoints;
