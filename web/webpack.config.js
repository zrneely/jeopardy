const path = require('path');
const webpack = require('webpack');

module.exports = {
    devtool: 'source-map',
    entry: './ts/index.tsx',
    module: {
        rules: [
            {
                test: /\.ts|\.tsx$/,
                use: 'ts-loader',
                include: path.resolve(__dirname, 'ts'),
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        alias: {
            autobahn: path.resolve(__dirname, 'node_modules/autobahn-browser'),
        },
    },
    output: {
        filename: 'index.bundle.js',
        path: path.resolve(__dirname, '../static'),
    },
};