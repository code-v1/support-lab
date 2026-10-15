import { db, all } from "../lib/db/index";
db();
console.log(
  `Support Lab database ready. ${all("SELECT id FROM customers").length} customer accounts. Knowledge starts empty.`,
);
