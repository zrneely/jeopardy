const path = require('path');
const webpack = require('webpack');

module.exports = {
    devtool: 'source-map',
    entry: './index.tsx',
    module: {
        rules: [
            {
                test: /\.ts|\.tsx$/,
                use: 'ts-loader',
                include: __dirname,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.jsx', '.ts', '.js'],
        alias: {
            autobahn: path.resolve(__dirname, 'node_modules/autobahn-browser'),
        },
    },
    output: {
        filename: 'index.bundle.js',
        path: path.resolve(__dirname, '../static'),
    },
};