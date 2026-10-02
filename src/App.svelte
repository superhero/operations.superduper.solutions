<script lang="ts">
  type Parameter = {
    name: string;
    in: "path" | "query" | "header";
    required?: boolean;
    description?: string;
  };

  type Operation = {
    key: string;
    method: string;
    path: string;
    summary: string;
    parameters: Parameter[];
    requestBody: boolean;
    servers?: Array<{ url: string }>;
  };

  type OpenApiDocument = {
    openapi?: string;
    info?: { title?: string };
    servers?: Array<{ url: string }>;
    paths?: Record<string, Record<string, unknown>>;
  };

  const httpMethods = new Set([
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace"
  ]);

  let sourceUrl = "https://petstore3.swagger.io/api/v3/openapi.json";
  let documentRef: OpenApiDocument | undefined;
  let operations: Operation[] = [];
  let selectedKey = "";
  let parameterValues: Record<string, string> = {};
  let requestBody = "";
  let sourceError = "";
  let runError = "";
  let responseStatus = "";
  let responseBody = "";
  let loading = false;
  let running = false;

  $: selectedOperation = operations.find((operation) => operation.key === selectedKey);

  function asRecord(value: unknown): Record<string, unknown> | undefined
  {
    return value !== null && typeof value === "object"
      ? value as Record<string, unknown>
      : undefined;
  }

  function parameterList(value: unknown): Parameter[]
  {
    if (!Array.isArray(value))
    {
      return [];
    }

    return value.flatMap((candidate) =>
    {
      const parameter = asRecord(candidate);

      if (
        !parameter
        || typeof parameter.name !== "string"
        || (parameter.in !== "path" && parameter.in !== "query" && parameter.in !== "header")
      )
      {
        return [];
      }

      return [{
        name: parameter.name,
        in: parameter.in,
        required: parameter.required === true,
        description: typeof parameter.description === "string"
          ? parameter.description
          : undefined
      }];
    });
  }

  function extractOperations(specification: OpenApiDocument): Operation[]
  {
    const result: Operation[] = [];

    for (const [path, pathValue] of Object.entries(specification.paths ?? {}))
    {
      const pathItem = asRecord(pathValue);

      if (!pathItem)
      {
        continue;
      }

      const sharedParameters = parameterList(pathItem.parameters);

      for (const [method, operationValue] of Object.entries(pathItem))
      {
        if (!httpMethods.has(method.toLowerCase()))
        {
          continue;
        }

        const operation = asRecord(operationValue);

        if (!operation)
        {
          continue;
        }

        const operationServers = Array.isArray(operation.servers)
          ? operation.servers.flatMap((server) =>
          {
            const serverRecord = asRecord(server);
            return serverRecord && typeof serverRecord.url === "string"
              ? [{ url: serverRecord.url }]
              : [];
          })
          : undefined;

        result.push({
          key: method.toUpperCase() + " " + path,
          method: method.toUpperCase(),
          path,
          summary: typeof operation.summary === "string" && operation.summary.length > 0
            ? operation.summary
            : method.toUpperCase() + " " + path,
          parameters: [
            ...sharedParameters,
            ...parameterList(operation.parameters)
          ],
          requestBody: operation.requestBody !== undefined,
          servers: operationServers
        });
      }
    }

    return result;
  }

  function resetExecution()
  {
    parameterValues = {};
    requestBody = "";
    runError = "";
    responseStatus = "";
    responseBody = "";
  }

  function selectOperation()
  {
    resetExecution();
  }

  function parameterKey(parameter: Parameter): string
  {
    return parameter.in + ":" + parameter.name;
  }

  function setParameter(parameter: Parameter, value: string)
  {
    parameterValues = {
      ...parameterValues,
      [parameterKey(parameter)]: value
    };
  }

  function selectedServer(): string
  {
    const operationServer = selectedOperation?.servers?.[0]?.url;
    const documentServer = documentRef?.servers?.[0]?.url;

    if (operationServer)
    {
      return operationServer;
    }

    if (documentServer)
    {
      return documentServer;
    }

    return new URL(".", sourceUrl).href.replace(/\/$/, "");
  }

  function requestUrl(operation: Operation): string
  {
    let path = operation.path;

    for (const parameter of operation.parameters.filter((item) => item.in === "path"))
    {
      const value = parameterValues[parameterKey(parameter)] ?? "";

      if (parameter.required && value.length === 0)
      {
        throw new Error('Missing required path parameter "' + parameter.name + '"');
      }

      path = path.replaceAll(
        "{" + parameter.name + "}",
        encodeURIComponent(value)
      );
    }

    const base = selectedServer().replace(/\/$/, "");
    const url = new URL(base + (path.startsWith("/") ? path : "/" + path));

    for (const parameter of operation.parameters.filter((item) => item.in === "query"))
    {
      const value = parameterValues[parameterKey(parameter)] ?? "";

      if (value.length > 0)
      {
        url.searchParams.append(parameter.name, value);
      }
    }

    return url.toString();
  }

  function requestHeaders(operation: Operation): Headers
  {
    const headers = new Headers();

    for (const parameter of operation.parameters.filter((item) => item.in === "header"))
    {
      const value = parameterValues[parameterKey(parameter)] ?? "";

      if (value.length > 0)
      {
        headers.set(parameter.name, value);
      }
    }

    if (operation.requestBody && requestBody.trim().length > 0)
    {
      headers.set("content-type", "application/json");
    }

    return headers;
  }

  async function loadSource()
  {
    loading = true;
    sourceError = "";
    operations = [];
    selectedKey = "";
    resetExecution();

    try
    {
      const response = await fetch(sourceUrl, {
        headers: {
          accept: "application/json, application/yaml, text/yaml, */*"
        }
      });

      if (!response.ok)
      {
        throw new Error("OpenAPI source returned HTTP " + response.status);
      }

      const specification = await response.json() as OpenApiDocument;

      if (!specification.paths)
      {
        throw new Error("The document does not contain OpenAPI paths");
      }

      const discoveredOperations = extractOperations(specification);

      if (discoveredOperations.length === 0)
      {
        throw new Error("The document contains no executable operations");
      }

      documentRef = specification;
      operations = discoveredOperations;
      selectedKey = discoveredOperations[0]?.key ?? "";
    }
    catch (error)
    {
      sourceError = error instanceof Error ? error.message : String(error);
      documentRef = undefined;
    }
    finally
    {
      loading = false;
    }
  }

  async function runOperation()
  {
    if (!selectedOperation)
    {
      return;
    }

    running = true;
    runError = "";
    responseStatus = "";
    responseBody = "";

    try
    {
      const headers = requestHeaders(selectedOperation);
      const body = selectedOperation.requestBody && requestBody.trim().length > 0
        ? requestBody
        : undefined;

      const response = await fetch(requestUrl(selectedOperation), {
        method: selectedOperation.method,
        headers,
        body
      });

      responseStatus = response.status + " " + response.statusText;

      const text = await response.text();

      try
      {
        responseBody = JSON.stringify(JSON.parse(text), null, 2);
      }
      catch
      {
        responseBody = text;
      }
    }
    catch (error)
    {
      runError = error instanceof Error ? error.message : String(error);
    }
    finally
    {
      running = false;
    }
  }
</script>

<svelte:head>
  <title>operations.superduper.solutions</title>
  <meta
    name="description"
    content="Explore and execute OpenAPI operations in the browser."
  />
</svelte:head>

<main class="app">
  <header class="hero">
    <p class="eyebrow">operations.superduper.solutions</p>
    <h1>Build a workflow from an OpenAPI operation.</h1>
    <p class="lead">
      Load a specification, choose an operation, provide its inputs, and execute it directly from this page.
    </p>
  </header>

  <section class="stage">
    <div class="stage-heading">
      <span class="step">1</span>
      <div>
        <h2>OpenAPI source</h2>
        <p>Start with a publicly reachable OpenAPI 3 document.</p>
      </div>
    </div>

    <div class="source-row">
      <label class="field grow">
        <span>Specification URL</span>
        <input
          bind:value={sourceUrl}
          type="url"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <button class="primary" onclick={loadSource} disabled={loading || sourceUrl.length === 0}>
        {loading ? "Loading…" : "Load"}
      </button>
    </div>

    {#if sourceError}
      <p class="error" role="alert">{sourceError}</p>
    {/if}

    {#if documentRef}
      <p class="success">
        Loaded {documentRef.info?.title ?? "OpenAPI document"} · {operations.length} operations
      </p>
    {/if}
  </section>

  <section class:disabled={operations.length === 0} class="stage">
    <div class="stage-heading">
      <span class="step">2</span>
      <div>
        <h2>Operation</h2>
        <p>Choose the API call that becomes the first workflow step.</p>
      </div>
    </div>

    <label class="field">
      <span>Operation</span>
      <select
        bind:value={selectedKey}
        onchange={selectOperation}
        disabled={operations.length === 0}
      >
        {#if operations.length === 0}
          <option value="">Load a source first</option>
        {:else}
          {#each operations as operation}
            <option value={operation.key}>
              {operation.method} · {operation.summary}
            </option>
          {/each}
        {/if}
      </select>
    </label>

    {#if selectedOperation}
      <div class="operation-card">
        <span class="method">{selectedOperation.method}</span>
        <code>{selectedOperation.path}</code>
      </div>
    {/if}
  </section>

  <section class:disabled={!selectedOperation} class="stage">
    <div class="stage-heading">
      <span class="step">3</span>
      <div>
        <h2>Request</h2>
        <p>Configure the selected operation and execute it.</p>
      </div>
    </div>

    {#if selectedOperation}
      {#if selectedOperation.parameters.length > 0}
        <div class="parameters">
          {#each selectedOperation.parameters as parameter (parameterKey(parameter))}
            <label class="field">
              <span>
                {parameter.name}
                <small>{parameter.in}{parameter.required ? " · required" : ""}</small>
              </span>
              <input
                value={parameterValues[parameterKey(parameter)] ?? ""}
                oninput={(event) => setParameter(parameter, event.currentTarget.value)}
                required={parameter.required}
                autocomplete="off"
              />
              {#if parameter.description}
                <small class="hint">{parameter.description}</small>
              {/if}
            </label>
          {/each}
        </div>
      {:else}
        <p class="muted">This operation declares no parameters.</p>
      {/if}

      {#if selectedOperation.requestBody}
        <label class="field">
          <span>JSON request body</span>
          <textarea
            bind:value={requestBody}
            rows="8"
            spellcheck="false"
            placeholder={'{"example": "value"}'}
          ></textarea>
        </label>
      {/if}

      <div class="run-row">
        <div>
          <span class="label">Target</span>
          <code class="target">{selectedServer()}{selectedOperation.path}</code>
        </div>
        <button class="primary" onclick={runOperation} disabled={running}>
          {running ? "Running…" : "Run operation"}
        </button>
      </div>

      {#if runError}
        <p class="error" role="alert">{runError}</p>
      {/if}
    {:else}
      <p class="muted">Select an operation before configuring a request.</p>
    {/if}
  </section>

  <section class:disabled={!responseStatus && !runError} class="stage result-stage">
    <div class="stage-heading">
      <span class="step">4</span>
      <div>
        <h2>Result</h2>
        <p>The response from the current workflow step appears here.</p>
      </div>
    </div>

    {#if responseStatus}
      <div class="response-heading">
        <span class="label">HTTP response</span>
        <strong>{responseStatus}</strong>
      </div>
      <pre>{responseBody || "(empty response body)"}</pre>
    {:else}
      <p class="muted">Run the operation to inspect its response.</p>
    {/if}
  </section>

  <footer>
    Runs entirely in the browser. APIs and OpenAPI documents must permit browser access.
  </footer>
</main>

<style>
  :global(:root) {
    --color-background: #023047;
    --color-surface: #219ebc;
    --color-foreground: #8ecae6;
    --color-accent: #ffb703;
    --color-emphasis: #fb8500;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background:
      radial-gradient(
        circle at top left,
        color-mix(in srgb, var(--color-surface) 24%, transparent),
        transparent 28rem
      ),
      var(--color-background);
    color: var(--color-foreground);
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
  }

  .app {
    width: min(72rem, calc(100% - 2rem));
    margin: 0 auto;
    padding: 4rem 0 2rem;
  }

  .hero {
    max-width: 48rem;
    margin-bottom: 2.5rem;
  }

  .eyebrow {
    margin: 0 0 0.75rem;
    color: var(--color-accent);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    color: var(--color-foreground);
    font-size: clamp(2.2rem, 7vw, 4.6rem);
    line-height: 0.98;
    letter-spacing: -0.055em;
  }

  .lead {
    margin: 1.25rem 0 0;
    color: color-mix(in srgb, var(--color-foreground) 78%, var(--color-surface));
    font-size: 1.08rem;
    line-height: 1.65;
  }

  .stage {
    margin: 1rem 0;
    padding: 1.4rem;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 34%, var(--color-background));
    border-radius: 1.1rem;
    background: color-mix(in srgb, var(--color-background) 76%, var(--color-surface));
    box-shadow:
      0 0.4rem 1.4rem
      color-mix(in srgb, var(--color-background) 76%, transparent);
  }

  .stage.disabled {
    opacity: 0.62;
  }

  .stage-heading {
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    margin-bottom: 1.2rem;
  }

  .stage-heading h2 {
    margin: 0;
    color: var(--color-foreground);
    font-size: 1.05rem;
  }

  .stage-heading p {
    margin: 0.25rem 0 0;
    color: color-mix(in srgb, var(--color-foreground) 72%, var(--color-surface));
    font-size: 0.92rem;
  }

  .step {
    display: grid;
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 999px;
    background: var(--color-accent);
    color: var(--color-background);
    font-size: 0.84rem;
    font-weight: 800;
  }

  .source-row,
  .run-row {
    display: flex;
    gap: 0.8rem;
    align-items: end;
  }

  .run-row {
    justify-content: space-between;
    margin-top: 1rem;
  }

  .grow {
    flex: 1;
  }

  .field {
    display: grid;
    gap: 0.45rem;
    margin: 0.8rem 0;
    color: var(--color-foreground);
    font-size: 0.88rem;
    font-weight: 700;
  }

  .field > span {
    display: flex;
    gap: 0.45rem;
    align-items: baseline;
  }

  input,
  select,
  textarea {
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 46%, var(--color-surface));
    border-radius: 0.7rem;
    background: color-mix(in srgb, var(--color-background) 64%, var(--color-surface));
    color: var(--color-foreground);
    outline: none;
  }

  input,
  select {
    min-height: 2.8rem;
    padding: 0 0.8rem;
  }

  textarea {
    padding: 0.8rem;
    resize: vertical;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    line-height: 1.5;
  }

  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--color-accent);
    box-shadow:
      0 0 0 3px
      color-mix(in srgb, var(--color-accent) 28%, transparent);
  }

  .primary {
    min-height: 2.8rem;
    padding: 0 1rem;
    border: 0;
    border-radius: 0.7rem;
    background: var(--color-accent);
    color: var(--color-background);
    cursor: pointer;
    font-weight: 800;
    white-space: nowrap;
  }

  .primary:hover:not(:disabled) {
    background: var(--color-emphasis);
  }

  .primary:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .operation-card {
    display: flex;
    gap: 0.7rem;
    align-items: center;
    margin-top: 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid color-mix(in srgb, var(--color-surface) 52%, var(--color-foreground));
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--color-background) 56%, var(--color-surface));
  }

  .method {
    color: var(--color-accent);
    font-size: 0.78rem;
    font-weight: 900;
  }

  code,
  pre {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }

  code {
    overflow-wrap: anywhere;
  }

  .parameters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0 1rem;
  }

  small,
  .hint,
  .muted,
  .label {
    color: color-mix(in srgb, var(--color-foreground) 70%, var(--color-surface));
  }

  small {
    font-weight: 500;
  }

  .muted {
    margin: 0;
  }

  .label {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .target {
    display: block;
    max-width: 44rem;
    color: var(--color-foreground);
    font-size: 0.83rem;
  }

  .success,
  .error {
    margin: 0.8rem 0 0;
    padding: 0.75rem 0.9rem;
    border-radius: 0.7rem;
    color: var(--color-background);
    font-size: 0.88rem;
    font-weight: 700;
  }

  .success {
    background: var(--color-accent);
  }

  .error {
    background: var(--color-emphasis);
  }

  .response-heading {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    margin-bottom: 0.7rem;
  }

  .response-heading .label {
    margin: 0;
  }

  pre {
    max-height: 30rem;
    margin: 0;
    padding: 1rem;
    overflow: auto;
    border: 1px solid color-mix(in srgb, var(--color-surface) 48%, var(--color-background));
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--color-background) 86%, var(--color-surface));
    color: var(--color-foreground);
    font-size: 0.82rem;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  footer {
    padding: 1rem 0 0;
    color: color-mix(in srgb, var(--color-foreground) 58%, var(--color-surface));
    font-size: 0.78rem;
    text-align: center;
  }

  @media (max-width: 42rem) {
    .app {
      padding-top: 2rem;
    }

    .source-row,
    .run-row {
      align-items: stretch;
      flex-direction: column;
    }

    .run-row .primary {
      width: 100%;
    }
  }
</style>
