export default {
  fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/style.css'||path==='/client.js')return env.ASSETS.fetch(request);
    const forwarded=new Request(request);
    const url=new URL(request.url);
    forwarded.headers.set('Host',url.host);
    forwarded.headers.set('X-Forwarded-Host',url.host);
    forwarded.headers.set('X-Forwarded-Proto',url.protocol.slice(0,-1));
    return env.TOURNAMENT.fetch(forwarded);
  }
};
