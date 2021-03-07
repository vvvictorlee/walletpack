const path = require('path');
const webpack = require('webpack')
const fs = require('fs');

const getPackagePath = x => `./packages/${x}/src/index.js`;
const packageFiles = fs.readdirSync('./packages');
const entry = packageFiles.reduce((o, file) => Object.assign(o, {[`${file}.min.js`]: getPackagePath(file)}), {});

module.exports = {
	entry,
	output: {
		path: path.resolve(__dirname, './bundles'),
		filename: 'walletpack-[name]'
	},
	resolve: {
		modules:[
			"node_modules"
		]
	},
	module: {
		rules: [
			{
				test: /\.js$/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: [
							'@babel/preset-env'
						],
						plugins:[
							'@babel/plugin-transform-runtime'
						]
					}
				},
				exclude: /node_modules/
			}
		],
	},
	plugins: [

	],
	stats: { colors: true },
	// devtool: false,
	devtool: 'inline-source-map',
	externals: {
		'@vvvictorlee2020/core': 'WalletPack'
	}
}
