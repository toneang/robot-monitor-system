const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader']
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource'
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      inject: 'body'
    })
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'public')
    },
    hot: true,
    server: 'https',
    port: 18080,
    host: '0.0.0.0', // 允许局域网访问
    proxy: {
      '/db': {
        target: 'http://127.0.0.1:8888',
        changeOrigin: true,
        pathRewrite: { '^/db': '/api' }
      },
      '/confirm': {
        target: 'http://10.130.5.129',
        changeOrigin: true,
        secure: false,
        pathRewrite: { '^/confirm': '' }
      },
      '/graph': {
        target: 'http://10.208.40.25:8002',
        changeOrigin: true,
        secure: false
      },
      '/profile': {
        target: 'http://10.208.40.25:8002',
        changeOrigin: true,
        secure: false
      },
      '/robot': {
        target: 'http://10.208.40.25:8002',
        changeOrigin: true,
        secure: false
      }
    }
  },
  resolve: {
    extensions: ['.js'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
};
