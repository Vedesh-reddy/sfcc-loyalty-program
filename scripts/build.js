'use strict';

const path = require('path');
const webpack = require('webpack');

const cartridge = path.resolve(__dirname, '../cartridges/plugin_loyalty/cartridge');

// The bundle only posts the checkout points panel; it needs no framework.
const compiler = webpack({
    mode: 'production',
    entry: path.join(cartridge, 'client/default/js/loyalty.js'),
    output: { path: path.join(cartridge, 'static/default/js'), filename: 'loyalty.js' }
});

compiler.run(function (error, stats) {
    compiler.close(function (closeError) {
        if (error || closeError || stats.hasErrors()) {
            console.error(error || closeError || stats.toString({ all: false, errors: true }));
            process.exitCode = 1;
            return;
        }
        console.log('Built loyalty.js in cartridge/static/default/js.');
    });
});
