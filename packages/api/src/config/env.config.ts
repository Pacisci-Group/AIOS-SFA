import { existsSync } from 'fs';
import { resolve } from 'path';

const candidates = [
  resolve(__dirname, '../../../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];

export const ENV_FILE_PATH =
  candidates.find((path) => existsSync(path)) ?? candidates[0];
