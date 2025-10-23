import * as crypto from 'crypto';


const key = "rdb_a69c968148867df2119ede9fce86d34b21d71e7fd533e2dc2982e7171933a1b4"


function getApiKeyHash(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 8);
}

console.log('API Key Hash:', getApiKeyHash(key));