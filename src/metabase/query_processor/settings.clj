(ns metabase.query-processor.settings
  (:require
   [metabase.settings.core :as setting :refer [defsetting]]
   [metabase.util.i18n :refer [deferred-tru]]))

(defsetting enable-pivoted-exports
  (deferred-tru "Enable pivoted exports and pivoted subscriptions")
  :type       :boolean
  :default    true
  :export?    true
  :visibility :authenticated
  :audit      :getter)

;;; the default values for the next two settings live in [[metabase.query-processor.middleware.constraints]] instead of
;;; as setting `:default`s... there is some sort of reason for this but I don't understand it -- Cam

;;; `:visibility :public` on the next two settings so the row-count footer can report the real limit rather than a
;;; hardcoded 2000 — public dashboards and static embeds only ever see `:public` settings.
(defsetting unaggregated-query-row-limit
  (deferred-tru "Maximum number of rows to return specifically on :rows type queries via the API.")
  :visibility     :public
  :export?        true
  :type           :integer
  :database-local :allowed
  :audit          :getter
  :doc            (str "Must be less than 1048575. This limit is clamped down to MB_AGGREGATED_QUERY_ROW_LIMIT, so to"
                       " raise the number of rows shown for raw-rows questions you must raise *both* settings — raising"
                       " this one alone has no effect beyond the aggregated limit."
                       " See also MB_AGGREGATED_QUERY_ROW_LIMIT."))

(defsetting aggregated-query-row-limit
  (deferred-tru "Maximum number of rows to return for aggregated queries via the API.")
  :visibility     :public
  :export?        true
  :type           :integer
  :database-local :allowed
  :audit          :getter
  :doc            (str "Must be less than 1048575. This also acts as a ceiling on MB_UNAGGREGATED_QUERY_ROW_LIMIT, so"
                       " raise it alongside that setting when increasing the number of rows shown for raw-rows"
                       " questions. See also MB_UNAGGREGATED_QUERY_ROW_LIMIT."))

(defsetting attachment-row-limit
  (deferred-tru "Row limit in file attachments excluding the header.")
  :visibility :internal
  :export?    true
  :type       :positive-integer)

;;; TODO (Cam 8/19/25) -- Make this a function backed by a dynamic variable so we can override it in tests without
;;; `with-redefs` but also let the imported var in the driver API pick up changes.
(def absolute-max-results
  "Maximum number of rows the QP should ever return.

  This is coming directly from the max rows allowed by Excel for now ...
  https://support.office.com/en-nz/article/Excel-specifications-and-limits-1672b34d-7043-467e-8e27-269d656771c3

  This is actually one less than the number of rows allowed by Excel, since we have a header row. See #13585 for more
  details."
  1048575)

(def ^:dynamic ^:private *minimum-download-row-limit*
  "Minimum download row limit. Using dynamic so we can rebind in tests"
  absolute-max-results)

;;; `:visibility :public` so the download modal can report the actual export ceiling instead of hardcoding "1 million
;;; rows", including on public questions and static embeds.
(defsetting download-row-limit
  (deferred-tru "Row limit in file exports excluding the header. Enforces 1048575 excluding header as minimum. xlsx downloads are inherently limited to 1048575 rows even if this limit is higher.")
  :visibility :public
  :export?    true
  :type       :positive-integer
  :getter     (fn []
                (let [limit (setting/get-value-of-type :positive-integer :download-row-limit)]
                  (if (nil? limit)
                    limit
                    (max limit *minimum-download-row-limit*)))))

(defsetting pivot-max-result-rows
  (deferred-tru "Maximum number of result rows for each pivot table sub-query.")
  :visibility :internal
  :export?    true
  :type       :positive-integer
  :default    200000
  :doc        (str "Divided by the number of aggregations in the pivot table, since each aggregation adds a column to"
                   " the output. Note that this overrides MB_AGGREGATED_QUERY_ROW_LIMIT for pivot tables, so raising"
                   " that setting alone will not show more rows in a pivot table."))

(defsetting csv-field-separator
  (deferred-tru "Character to use as field separator in CSV exports. Defaults to comma (,). Common alternatives include semicolon (;) for European locales and tab (\\t).")
  :type       :string
  :default    ","
  :visibility :public
  :export?    true
  :encryption :no
  :audit      :getter)
