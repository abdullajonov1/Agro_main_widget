/**
 * Single import site for geotiff compression decoders.
 * geotiff's package.json only exports "." — deep imports fail under webpack 5.
 * Relative node_modules paths (6 levels from src/vendor → client/) bypass exports.
 *
 * Register ALL codecs here so Portal does not load widgets/chunks/* via
 * jimuConfig.baseUrl (those URLs 404 on Enterprise custom-widget hosts).
 */
import RawDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/raw.js";
import LzwDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/lzw.js";
import DeflateDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/deflate.js";
import PackbitsDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/packbits.js";
import JpegDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/jpeg.js";
import LercDecoder, {
  zstd as lercZstd,
} from "../../../../../../node_modules/geotiff/dist-module/compression/lerc.js";
import ZstdDecoder, {
  zstd as zstdInit,
} from "../../../../../../node_modules/geotiff/dist-module/compression/zstd.js";
import WebImageDecoder from "../../../../../../node_modules/geotiff/dist-module/compression/webimage.js";

export {
  RawDecoder,
  LzwDecoder,
  DeflateDecoder,
  PackbitsDecoder,
  JpegDecoder,
  LercDecoder,
  lercZstd,
  ZstdDecoder,
  zstdInit,
  WebImageDecoder,
};
