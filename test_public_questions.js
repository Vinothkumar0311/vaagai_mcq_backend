const BASE_URL = 'https://vaagai-mcq-backend.onrender.com';

async function testPublicQuestions() {
  try {
    const sessionId = 'test-session-' + Date.now();
    const url = `${BASE_URL}/api/public/test/TST-1001/questions?sessionId=${sessionId}&name=Tester`;
    console.log('Querying:', url);
    const res = await fetch(url);
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testPublicQuestions();
