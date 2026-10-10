// Under proot (UserLAnd/Termux) on newer Android, os.networkInterfaces()
// throws "uv_interface_addresses returned Unknown system error 13", which
// crashes `expo start`. Fall back to loopback only; Expo Go on the same
// phone connects over 127.0.0.1 anyway.
const os = require('os');
const original = os.networkInterfaces;

os.networkInterfaces = function networkInterfaces() {
  try {
    return original.call(os);
  } catch {
    return {
      lo: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
    };
  }
};
