// ============================================================
// FILE: tests/unit testing/helpers/httpMocks.js
// Fungsi: Helper bersama untuk membuat objek req/res tiruan
// (mock) yang dipakai di seluruh unit test controller.
//
// Kenapa dipisah ke file sendiri?
// Supaya semua test controller punya cara yang SAMA & KONSISTEN
// dalam mensimulasikan Express req/res, tanpa duplikasi kode
// mock di setiap file test.
// ============================================================

/**
 * Membuat pasangan req/res tiruan untuk testing controller Express.
 *
 * @param {Object} options
 * @param {Object} options.params  - req.params (default: {})
 * @param {Object} options.query   - req.query  (default: {})
 * @param {Object} options.body    - req.body   (default: {})
 * @param {Object} options.session - req.session (default: {})
 * @returns {{ req: Object, res: Object }}
 */
function mockReqRes({ params = {}, query = {}, body = {}, session = {} } = {}) {
    const req = { params, query, body, session };

    const res = {
        statusCode: 200,
        rendered: null,
        renderData: null,
        redirectedTo: null,
        jsonData: null,
        sentBody: null,
        headers: {},
        ended: false,

        status: jest.fn(function (code) {
            res.statusCode = code;
            return res;
        }),
        render: jest.fn(function (view, data) {
            res.rendered = view;
            res.renderData = data;
            return res;
        }),
        redirect: jest.fn(function (url) {
            res.redirectedTo = url;
            return res;
        }),
        json: jest.fn(function (data) {
            res.jsonData = data;
            return res;
        }),
        send: jest.fn(function (body) {
            res.sentBody = body;
            return res;
        }),
        setHeader: jest.fn(function (key, value) {
            res.headers[key] = value;
            return res;
        }),
        end: jest.fn(function () {
            res.ended = true;
            return res;
        }),
    };

    return { req, res };
}

/**
 * Membuat mock Workbook ExcelJS yang aman dipakai di test tanpa
 * benar-benar menulis file .xlsx. Dipakai bersama jest.mock('exceljs').
 */
function buatWorksheetMock() {
    return {
        columns: [],
        views: [],
        addRow: jest.fn(),
        mergeCells: jest.fn(),
        getRow: jest.fn(() => ({
            font: {}, fill: {}, height: 0,
            eachCell: jest.fn(),
        })),
        getCell: jest.fn(() => ({ font: {}, fill: {}, alignment: {}, border: {}, value: null })),
        getColumn: jest.fn(() => ({ width: 0 })),
    };
}

function buatWorkbookMock() {
    const worksheet = buatWorksheetMock();
    return {
        creator: '',
        addWorksheet: jest.fn(() => worksheet),
        xlsx: { write: jest.fn(() => Promise.resolve()) },
        __worksheet: worksheet, // akses langsung dari test kalau perlu assert
    };
}

module.exports = { mockReqRes, buatWorksheetMock, buatWorkbookMock };
