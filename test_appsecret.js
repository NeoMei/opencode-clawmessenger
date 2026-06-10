const axios = require('axios');

async function testGetAppSecret() {
  const serverUrl = 'https://newsradar.dreamdt.cn/im';
  const token = 'vAdXwgpIXn7y3DYsJbey';

  console.log('Testing GET /api/config/rongcloud/secret...');
  console.log(`URL: ${serverUrl}/api/config/rongcloud/secret`);
  console.log(`Token: ${token}`);

  try {
    const response = await axios.get(`${serverUrl}/api/config/rongcloud/secret`, {
      timeout: 10000,
      headers: {
        'X-Node-Token': token
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false
      })
    });

    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.response?.status, error.response?.data || error.message);
  }
}

testGetAppSecret();
