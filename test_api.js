const axios = require('axios');
const https = require('https');

async function testAppSecret() {
  const serverUrl = 'https://newsradar.dreamdt.cn/im';
  const token = 'vAdXwgpIXn7y3DYsJbeympjj1yzip/HYFAcFSU2tIJI=';

  console.log('Testing with exact token from client...');
  console.log('Token length:', token.length);

  try {
    const response = await axios.get(`${serverUrl}/api/config/rongcloud/secret`, {
      timeout: 10000,
      headers: {
        'X-Node-Token': token
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });

    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.response?.status, error.response?.data || error.message);
  }
}

testAppSecret();
