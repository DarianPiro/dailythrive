const fs = require("fs");
const yaml = require("js-yaml");
const SpotifyWebApi = require("spotify-web-api-node");

const config = yaml.load(fs.readFileSync("config.yaml", "utf8"));
const token = JSON.parse(fs.readFileSync(".spotify-token.json", "utf8"));

const api = new SpotifyWebApi({
  clientId: config.spotify.client_id,
  clientSecret: config.spotify.client_secret,
  redirectUri: config.spotify.redirect_uri,
});
api.setAccessToken(token.access_token);
api.setRefreshToken(token.refresh_token);

async function main() {
  const d = await api.refreshAccessToken();
  api.setAccessToken(d.body.access_token);

  const podcasts = config.podcasts || [];
  console.log("show_id | total_eps | last5 release_dates | name (flag)");
  console.log("-".repeat(100));
  for (const p of podcasts) {
    try {
      const show = (await api.getShow(p.id, { market: "DE" })).body;
      const ep = await api.getShowEpisodes(p.id, { limit: 5, market: "DE" });
      const dates = ep.body.items.map((e) => e.release_date).join(", ");
      const ephTag = p.ephemeral ? " [already ephemeral]" : "";
      console.log(
        `${p.id} | ${String(show.total_episodes).padStart(6)} | ${dates} | ${p.name}${ephTag}`
      );
    } catch (e) {
      console.log(`${p.id} | ERR ${e.message} | ${p.name}`);
    }
  }
}
main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
