const cursorTs = new Date('1970-01-01T00:00:00.000Z');
const OVERLAP_MS = 10 * 60 * 1000; // 10 minutes
const startTime = new Date(cursorTs.getTime() - OVERLAP_MS);

console.log('Cursor TS:', cursorTs);
console.log('Start Time:', startTime);
console.log('Start Time in ms:', startTime.getTime());

// Test the API call
const testAddresses = [
  '0x615f9484c8f46ca4fd4d2c0291c42661043a3d87',
  '0x1c768f9c263f85cac55846011cc4a194fea5ff11',
  '0x404a0428ebe37813b37a8a908e3d5a350d8b5158'
];

async function testAPI(address) {
  const payload = {
    type: 'userFillsByTime',
    user: address,
    startTime: startTime.getTime()
  };

  console.log('\n--- Testing address:', address);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('Status:', response.status, response.statusText);

    if (!response.ok) {
      const text = await response.text();
      console.log('Error response:', text);
    } else {
      const data = await response.json();
      console.log('Success! Received', data.length, 'fills');
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

(async () => {
  for (const addr of testAddresses) {
    await testAPI(addr);
  }
})();
