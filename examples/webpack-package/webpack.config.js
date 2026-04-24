import HtmlWebpackPlugin from "html-webpack-plugin";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default {
  entry: resolve(rootDir, "src/main.js"),
  output: {
    path: resolve(rootDir, "dist"),
    filename: "assets/[name].[contenthash].js",
    assetModuleFilename: "assets/[name].[contenthash][ext]",
    clean: true,
  },
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: resolve(rootDir, "index.html"),
    }),
  ],
  devServer: {
    host: "0.0.0.0",
    port: 8080,
  },
  ignoreWarnings: [
    {
      module: /node_modules\/nimio-player\/pkg\/nimio\.js/,
      message:
        /Critical dependency: the request of a dependency is an expression/,
    },
  ],
  performance: {
    hints: false,
  },
};
