# Mosaic Demo (Multiple Players on One Page)

This example shows how to render two Nimio players at the same time on a single page.
It uses two containers (`#video1` and `#video2`) and creates two separate `Nimio` instances. Replace the example `streamUrl` with your actual SLDP endpoints.

```html
<div id="video1"></div>
<div id="video2"></div>
<script type="module" src="/dist/nimio.js"></script>
<script>
  let nimio = new Nimio({
    streamUrl: "wss://example.com/streamUrl1",
    container: "video1",
  });

  let nimio2 = new Nimio({
    streamUrl: "wss://example.com/streamUrl2",
    container: "video2",
  });
</script>
```
