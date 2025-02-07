import path from 'path';
import process from 'process';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

export default {
  entry: './src/main.ts',
  output: {
    path: path.resolve(__dirname, isProduction ? 'dist' : 'dist-dev'),
    filename: 'idb.mjs',
    library: {
      type: 'module',
    },
  },
  experiments: {
    outputModule: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
      },
    ],
  },
};
