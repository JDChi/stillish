import { test } from "bun:test";
import { checkAndroidFormat, checkAppleFormat, checkCoverSelection } from "./format-cases";

test("Apple pairing, timed track, and MOV chunk offsets", checkAppleFormat);
test("Android APP0, XMP, and MP4 boundary", checkAndroidFormat);
test("cover selection matches Python", checkCoverSelection);
