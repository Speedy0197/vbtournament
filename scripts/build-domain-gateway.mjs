import fs from 'node:fs/promises';
await fs.mkdir('dist/domain-gateway',{recursive:true});
const files=['style.css','client.js'];
const allow=new Set([...files,'_worker.js','_routes.json']);
for(const file of await fs.readdir('dist/domain-gateway'))if(!allow.has(file))throw new Error('Unexpected domain gateway asset: '+file);
for(const file of files)await fs.copyFile('public/'+file,'dist/domain-gateway/'+file);
await fs.copyFile('cloudflare/domain-gateway/_worker.js','dist/domain-gateway/_worker.js');
await fs.writeFile('dist/domain-gateway/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:[]}));
console.log('Built custom-domain gateway.');
