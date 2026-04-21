import { expect, test } from "bun:test";

import { buildFileActivity } from "./activity-signals";

test("buildFileActivity uses create verb for added view files", () => {
  expect(
    buildFileActivity(
      {
        name: "Dashboard ERP",
        displayName: "Dashboard ERP",
      },
      "resources/views/request-check-progress.blade.php",
      {
        gitStatuses: ["A"],
      },
    ),
  ).toBe("Dashboard ERP : Menambahkan tampilan request check progress");
});

test("buildFileActivity keeps update verb for modified view files", () => {
  expect(
    buildFileActivity(
      {
        name: "Dashboard ERP",
        displayName: "Dashboard ERP",
      },
      "resources/views/request-check-progress.blade.php",
      {
        gitStatuses: ["M"],
      },
    ),
  ).toBe("Dashboard ERP : Memperbarui tampilan request check progress");
});

test("buildFileActivity shortens noisy handler filenames into concise activity labels", () => {
  expect(
    buildFileActivity(
      {
        name: "api_erp",
        displayName: "API ERP GO",
      },
      "handlers/detail-group-tracking-payment-per-customer.go",
      {
        gitStatuses: ["M"],
      },
    ),
  ).toBe("API ERP GO : Memperbarui handler tracking payment per customer");

  expect(
    buildFileActivity(
      {
        name: "api_erp",
        displayName: "API ERP GO",
      },
      "handlers/group-customer-income-per-marketing.go",
      {
        gitStatuses: ["M"],
      },
    ),
  ).toBe("API ERP GO : Memperbarui handler income per marketing");
});
