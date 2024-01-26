'use strict';

function getData() {
	return {
	  "summary": [
	    {
	      "STATUS": [
	        {
	          "STATUS": "S",
	          "When": 1541144892,
	          "Code": 11,
	          "Msg": "Summary",
	          "Description": "bfgminer 5.4.2"
	        }
	      ],
	      "SUMMARY": [
	        {
	          "Elapsed": 847,
	          "MHS av": getRandomFloat(3.00, 4.00),
	          "MHS 20s": 3.324,
	          "Found Blocks": 0,
	          "Getworks": 30,
	          "Accepted": 168,
	          "Rejected": 0,
	          "Hardware Errors": 2,
	          "Utility": 11.9,
	          "Discarded": 78,
	          "Stale": 0,
	          "Get Failures": 0,
	          "Local Work": 138,
	          "Remote Failures": 0,
	          "Network Blocks": 5,
	          "Total MH": 2849.3488,
	          "Diff1 Work": 0.67822266,
	          "Work Utility": 0.048,
	          "Difficulty Accepted": 0.65625,
	          "Difficulty Rejected": 0,
	          "Difficulty Stale": 0,
	          "Best Share": 1.03726997,
	          "Device Hardware%": 0.1438,
	          "Device Rejected%": 0,
	          "Pool Rejected%": 0,
	          "Pool Stale%": 0,
	          "Last getwork": 1541144888
	        }
	      ],
	      "id": 1
	    }
	  ],
	  "devs": [
	    {
	      "STATUS": [
	        {
	          "STATUS": "S",
	          "When": 1541144892,
	          "Code": 9,
	          "Msg": "1 PGA(s)",
	          "Description": "bfgminer 5.4.2"
	        }
	      ],
	      "DEVS": [
	        {
	          "PGA": 0,
	          "Name": "MLD",
	          "ID": 0,
	          "Enabled": "Y",
	          "Status": "Alive",
	          "Device Elapsed": 847,
	          "MHS av": 3.363,
	          "MHS 20s": 3.373,
	          "MHS rolling": 3.373,
	          "Accepted": 168,
	          "Rejected": 0,
	          "Hardware Errors": 2,
	          "Utility": 11.897,
	          "Stale": 0,
	          "Last Share Pool": 1,
	          "Last Share Time": 1541144887,
	          "Total MH": 2849.3488,
	          "Diff1 Work": 0.67822266,
	          "Work Utility": 0.048,
	          "Difficulty Accepted": 0.65625,
	          "Difficulty Rejected": 0,
	          "Difficulty Stale": 0,
	          "Last Share Difficulty": 0.00390625,
	          "Last Valid Work": 1541144891,
	          "Device Hardware%": 0.1438,
	          "Device Rejected%": 0
	        }
	      ],
	      "id": 1
	    }
	  ],
	  "pools": [
	    {
	      "STATUS": [
	        {
	          "STATUS": "S",
	          "When": 1541144892,
	          "Code": 7,
	          "Msg": "2 Pool(s)",
	          "Description": "bfgminer 5.4.2"
	        }
	      ],
	      "POOLS": [
	        {
	          "POOL": 0,
	          "URL": "stratum+tcp://us.litecoinpool.org:3333",
	          "Status": "Alive",
	          "Priority": 1,
	          "Quota": 1,
	          "Mining Goal": "default",
	          "Long Poll": "N",
	          "Getworks": 3,
	          "Accepted": 0,
	          "Rejected": 0,
	          "Works": 0,
	          "Discarded": 0,
	          "Stale": 0,
	          "Get Failures": 0,
	          "Remote Failures": 0,
	          "User": "jstefanop.a1",
	          "Last Share Time": 0,
	          "Diff1 Shares": 0,
	          "Proxy": "",
	          "Difficulty Accepted": 0,
	          "Difficulty Rejected": 0,
	          "Difficulty Stale": 0,
	          "Last Share Difficulty": 0,
	          "Has Stratum": true,
	          "Stratum Active": true,
	          "Stratum URL": "",
	          "Best Share": 0,
	          "Pool Rejected%": 0,
	          "Pool Stale%": 0
	        },
	        {
	          "POOL": 1,
	          "URL": "stratum+tcp://us.litecoinpool.org:3333",
	          "Status": "Alive",
	          "Priority": 0,
	          "Quota": 99,
	          "Mining Goal": "default",
	          "Long Poll": "N",
	          "Getworks": 27,
	          "Accepted": 168,
	          "Rejected": 0,
	          "Works": 30,
	          "Discarded": 78,
	          "Stale": 0,
	          "Get Failures": 0,
	          "Remote Failures": 0,
	          "User": "jstefanop.1",
	          "Last Share Time": 1541144887,
	          "Diff1 Shares": 0.67822266,
	          "Proxy": "",
	          "Difficulty Accepted": 0.65625,
	          "Difficulty Rejected": 0,
	          "Difficulty Stale": 0,
	          "Last Share Difficulty": 0.00390625,
	          "Has Stratum": true,
	          "Stratum Active": true,
	          "Stratum URL": "us.litecoinpool.org",
	          "Best Share": 1.03726997,
	          "Pool Rejected%": 0,
	          "Pool Stale%": 0
	        }
	      ],
	      "id": 1
	    }
	  ],
	  "id": 1
	}
}
 
const net = require('net');
const PORT = 4028;
const HOST = 'localhost';

function getRandomArbitrary(min, max) {
	return Math.random() * (max - min) + min;
}

function getRandomFloat(min, max) {
	return parseFloat(Math.random() * (max - min) + min);
}
 
class Server {
 constructor(port, address) {
  this.port = port || PORT;
  this.address = address || HOST;
  
  this.init();
 }
 
 init() {
  let server = this;
 
  let onClientConnected = (sock) => {
 
   let clientName = `${sock.remoteAddress}:${sock.remotePort}`;
   console.log(`new client connected: ${clientName}`);
 
   sock.on('data', (data) => {
    console.log(`${clientName} Says: ${data}`);
    sock.write(JSON.stringify(getData()));
    // sock.write('exit');
   });
 
   sock.on('close', () => {
    console.log(`connection from ${clientName} closed`);
   });
 
   sock.on('error', (err) => {
    console.log(`Connection ${clientName} error: ${err.message}`);
   });
  }
 
  server.connection = net.createServer(onClientConnected);
 
  server.connection.listen(PORT, HOST, function() {
   console.log(`Server started at: ${HOST}:${PORT}`);
  });
 }
}

new Server();