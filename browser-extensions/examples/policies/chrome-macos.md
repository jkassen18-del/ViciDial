# macOS (Chrome and Edge)

Deploy a configuration profile through your MDM (Jamf, Intune, Kandji, …)
with the payload domain `com.google.Chrome` (Edge: `com.microsoft.Edge`).
Extension settings go under `3rdparty → extensions → <EXTENSION_ID>`:

```xml
<key>3rdparty</key>
<dict>
  <key>extensions</key>
  <dict>
    <key>GO_LINKS_EXTENSION_ID</key>
    <dict>
      <key>sources</key>
      <array>
        <dict>
          <key>url</key><string>https://intranet.acme.example/go-links.json</string>
          <key>name</key><string>Company</string>
        </dict>
      </array>
      <key>brand</key>
      <dict>
        <key>companyName</key><string>Acme Inc.</string>
        <key>primary</key><string>#4F46E5</string>
      </dict>
    </dict>
  </dict>
</dict>
```
