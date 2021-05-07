const path = require('path');
const nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  entry: './index.js',

  output: {
    filename: 'app.min.js',
    path: path.resolve(__dirname),
  },

  target: 'node',
  externals: [
    nodeExternals(),
  ],

  devtool: 'source-map',
  plugins: [
    new TerserPlugin({
      sourceMap: true,
      parallel: true,
      terserOptions: {
        ecma: 6,
      },
    }),
  ],

};
