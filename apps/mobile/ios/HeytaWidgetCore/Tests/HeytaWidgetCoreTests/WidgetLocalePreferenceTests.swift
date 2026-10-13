import Foundation
import XCTest
@testable import HeytaWidgetCore
import HeytaWidgetUI

final class WidgetLocalePreferenceTests: XCTestCase {
    func testApplicationSelectionOverridesOppositeSystemLocaleForStrings() {
        let zh = WidgetStrings(language: .current(preferred: ["en-US"], applicationLocale: "zh-CN"))
        let en = WidgetStrings(language: .current(preferred: ["zh-Hans-CN"], applicationLocale: "en"))
        XCTAssertEqual(zh.focusInProgress, WidgetStrings(language: .zh).focusInProgress)
        XCTAssertEqual(en.focusInProgress, WidgetStrings(language: .en).focusInProgress)
        XCTAssertNotEqual(zh.focusInProgress, en.focusInProgress)
        XCTAssertEqual(WidgetLanguage.current(preferred: ["en-US"], applicationLocale: "invalid"), .en)
    }

    func testSeparateFilePersistsForAnotherReaderWithoutTouchingSnapshot() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let snapshot = directory.appendingPathComponent(WidgetSharedConstants.snapshotFileName)
        try Data("encrypted-fixture".utf8).write(to: snapshot)
        let preference = directory.appendingPathComponent(WidgetLocalePreference.fileName)
        try WidgetLocalePreference.write("zh-CN", to: preference)
        XCTAssertEqual(WidgetLocalePreference.read(from: preference), "zh-CN")
        try WidgetLocalePreference.write("en", to: preference)
        XCTAssertEqual(WidgetLocalePreference.read(from: preference), "en")
        XCTAssertEqual(try Data(contentsOf: snapshot), Data("encrypted-fixture".utf8))
    }

    func testMalformedOrUnsupportedPreferenceFallsBackAndInvalidWritePreservesSelection() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertNil(WidgetLocalePreference.read(from: url))
        try Data("not-json".utf8).write(to: url)
        XCTAssertNil(WidgetLocalePreference.read(from: url))
        try Data(#"{"locale":"unsupported"}"#.utf8).write(to: url)
        XCTAssertNil(WidgetLocalePreference.read(from: url))
        try WidgetLocalePreference.write("zh-CN", to: url)
        XCTAssertThrowsError(try WidgetLocalePreference.write("unsupported", to: url))
        XCTAssertEqual(WidgetLocalePreference.read(from: url), "zh-CN")
        XCTAssertThrowsError(try WidgetLocalePreference.write("en", to: nil))
    }
}
