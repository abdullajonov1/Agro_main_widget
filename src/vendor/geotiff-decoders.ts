/**
 * Single import site for geotiff compression decoders.
 * geotiff's package.json only exports "." — deep imports fail under webpack 5.
 * Relative node_modules paths (6 levels from src/vendor → client/) bypass exports.
 */
import RawDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/raw.js";
import LzwDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/lzw.js";
import DeflateDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/deflate.js";
import PackbitsDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/packbits.js";

export { RawDecoder, LzwDecoder, DeflateDecoder, PackbitsDecoder };
