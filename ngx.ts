import ngx from "jsr:@char/ngx@0.2";

export const config = ngx(undefined, [
  ngx("server", [
    ngx.serverName("tool.umm.gay"),
    ngx.listen(),
    ngx.letsEncrypt("tool.umm.gay"),
    ngx("location /", [
      "charset utf-8",
      "root /srv/www/tool.umm.gay/hub/public",
    ]),
  ]),
  ngx("server", [
    `server_name ~^(?<subdomain>.+)\.tool\.umm\.gay$`,
    ngx.listen(),
    ngx.letsEncrypt("tool.umm.gay"),
    ngx("location /", [
      "charset utf-8",
      "add_header Access-Control-Allow-Origin *",
      `root /srv/www/tool.umm.gay/$subdomain/public`,
    ]),
  ]),
]);
