const path = require('path');
const webpack = require('webpack');

module.exports = {
    devtool: 'source-map',
    entry: './index.ts',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            autobahn: path.resolve(__dirname, 'node_modules/autobahn-browser'),
        },
    },
    output: {
        filename: 'index.bundle.js',
        path: path.resolve(__dirname, '../static'),
    },
};