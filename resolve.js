const dns = require('dns');
const http = require('http');

dns.setServers(['8.8.8.8', '1.1.1.1']);

console.log('Resolving vaagaimcqbk.vinothvk.in...');
dns.resolve4('vaagaimcqbk.vinothvk.in', (err, addresses) => {
  if (err) {
    console.error('DNS Resolution error:', err);
    return;
  }
  console.log('Resolved IP addresses:', addresses);

  for (const ip of addresses) {
    console.log(`Sending GET request to http://${ip}/health with Host header...`);
    const req = http.request({
      host: ip,
      port: 80,
      path: '/health',
      method: 'GET',
      headers: { Host: 'vaagaimcqbk.vinothvk.in' },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`[${ip}] Response status:`, res.statusCode);
        console.log(`[${ip}] Response headers:`, res.headers);
        console.log(`[${ip}] Response data:`, data);
      });
    });

    req.on('error', (reqErr) => {
      console.error(`[${ip}] Request failed:`, reqErr.message);
    });

    req.on('timeout', () => {
      console.error(`[${ip}] Request timed out`);
      req.destroy();
    });

    req.end();
  }
});
