import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb", // POS material-receipt export reports run a few MB
    },
  },
  async redirects() {
    return [
      {
        // จัดหมวดสินค้า POS was named coffee-items when it covered the coffee
        // shop alone; it has classified every POS product for a while
        // (queue item 13, renamed 2026-09-18). Nik has the old URL
        // bookmarked, and two applied SQL files name it in their text.
        //
        // 307, not 308: a permanent redirect is cached by the browser for
        // good, and this is an internal tool where being able to undo a
        // rename is worth more than saving one hop.
        source: "/owner/accounting/coffee-items",
        destination: "/owner/accounting/pos-item-categories",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
