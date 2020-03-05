'use strict';

const net = require('net');
const PORT = 4028;
const HOST = '127.0.0.1';

class Client {
 constructor(port, address) {
  this.socket = new net.Socket();
  this.address = address || HOST;
  this.port = port || PORT;
  this.init();
 }

 init() {
  var client = this;
  client.socket.connect(client.port, client.address, () => {
   console.log(`Client connected to: ${client.address} :  ${client.port}`);
  });

  client.socket.on('close', () => {
   console.log('Client closed');
  });
 }
}

module.exports = Client;
