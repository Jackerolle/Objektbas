using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(options =>
{
    options.AddPolicy("web-client", policy =>
    {
        policy
            .WithOrigins("http://localhost:3000")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<ObjectStore>();
builder.Services.AddSingleton<AggregateStore>();
builder.Services.AddHttpClient<IImageAnalysisService, GeminiImageAnalysisService>(client =>
{
    client.BaseAddress = new Uri("https://generativelanguage.googleapis.com/");
    client.Timeout = TimeSpan.FromSeconds(45);
});

var app = builder.Build();

app.UseCors("web-client");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

// Legacy endpoints used by earlier UI.
app.MapGet("/objects", (ObjectStore store) => Results.Ok(store.GetAll()));

app.MapPost("/objects", (CreateObjectRequest request, ObjectStore store) =>
    Results.Ok(store.Add(request)));

app.MapPost("/observations", async Task<Results<Created<Observation>, BadRequest<string>>> (
    ObservationRequest request,
    ObjectStore store) =>
{
    if (!store.Exists(request.ObjectId))
    {
        return TypedResults.BadRequest($"Objekt {request.ObjectId} saknas.");
    }

    var observation = new Observation(
        Guid.NewGuid(),
        request.ObjectId,
        request.Notes ?? string.Empty,
        request.ImageDataUrl,
        DateTimeOffset.UtcNow);

    await store.AddObservation(observation);
    return TypedResults.Created($"/observations/{observation.Id}", observation);
});

app.MapGet("/observations", (ObjectStore store) => Results.Ok(store.GetObservations()));

// New aggregate flow.
app.MapPost("/ai/systemposition", async Task<Results<Ok<SystemPositionAnalysisResponse>, BadRequest<string>>> (
    AnalyzeImageRequest request,
    IImageAnalysisService service,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.ImageDataUrl))
    {
        return TypedResults.BadRequest("Bild saknas.");
    }

    try
    {
        var result = await service.AnalyzeSystemPositionAsync(request.ImageDataUrl, cancellationToken);
        return TypedResults.Ok(result);
    }
    catch (Exception ex)
    {
        return TypedResults.BadRequest($"Kunde inte analysera systemposition: {ex.Message}");
    }
});

app.MapPost("/ai/component", async Task<Results<Ok<ComponentAnalysisResponse>, BadRequest<string>>> (
    AnalyzeComponentRequest request,
    IImageAnalysisService service,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.ComponentType) || string.IsNullOrWhiteSpace(request.ImageDataUrl))
    {
        return TypedResults.BadRequest("Komponenttyp och bild kravs.");
    }

    try
    {
        var result = await service.AnalyzeComponentAsync(request.ComponentType, request.ImageDataUrl, cancellationToken);
        return TypedResults.Ok(result);
    }
    catch (Exception ex)
    {
        return TypedResults.BadRequest($"Kunde inte analysera komponentbild: {ex.Message}");
    }
});

app.MapPost("/aggregates", Results<Created<VentilationAggregate>, BadRequest<string>> (
    CreateAggregateRequest request,
    AggregateStore store) =>
{
    if (string.IsNullOrWhiteSpace(request.SystemPositionId))
    {
        return TypedResults.BadRequest("Systempositionens ID kravs.");
    }

    var aggregate = store.Create(request);
    return TypedResults.Created($"/aggregates/{aggregate.Id}", aggregate);
});

app.MapGet("/aggregates", (string? query, AggregateStore store) =>
    Results.Ok(store.Search(query)));

app.MapGet("/aggregates/{id:guid}", Results<Ok<VentilationAggregate>, NotFound> (
    Guid id,
    AggregateStore store) =>
{
    if (!store.TryGet(id, out var aggregate))
    {
        return TypedResults.NotFound();
    }

    return TypedResults.Ok(aggregate!);
});

app.MapPost("/aggregates/{id:guid}/components", Results<Ok<VentilationAggregate>, NotFound, BadRequest<string>> (
    Guid id,
    CreateAggregateComponentRequest request,
    AggregateStore store) =>
{
    if (string.IsNullOrWhiteSpace(request.ComponentType))
    {
        return TypedResults.BadRequest("Komponenttyp kravs.");
    }

    if (string.IsNullOrWhiteSpace(request.IdentifiedValue))
    {
        return TypedResults.BadRequest("Identifierat varde kravs.");
    }

    if (!ComponentSchema.IsKnownType(request.ComponentType))
    {
        return TypedResults.BadRequest(
            $"Okand komponenttyp. Tillatna typer: {string.Join(", ", ComponentSchema.AllTypes)}.");
    }

    var missingFields = ComponentSchema.GetMissingRequiredFields(request.ComponentType, request.Attributes);
    if (missingFields.Length > 0)
    {
        return TypedResults.BadRequest(
            $"Falt saknas for {request.ComponentType}: {string.Join(", ", missingFields)}.");
    }

    if (!store.TryAddComponent(id, request, out var aggregate))
    {
        return TypedResults.NotFound();
    }

    return TypedResults.Ok(aggregate!);
});

app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

app.Run();

record CreateObjectRequest(
    string Name,
    string Category,
    string Location,
    string[] Tags);

record ObservationRequest(
    string ObjectId,
    string? Notes,
    string? ImageDataUrl);

record Objekt(
    string Id,
    string Name,
    string Category,
    string Location,
    IEnumerable<string> Tags,
    DateTimeOffset UpdatedAt,
    IEnumerable<Equipment> Equipment,
    string LastService);

record Equipment(
    string Id,
    string Name,
    int Quantity,
    string Status);

record Observation(
    Guid Id,
    string ObjectId,
    string Notes,
    string? ImageDataUrl,
    DateTimeOffset Timestamp);

record AnalyzeImageRequest(string ImageDataUrl);

record AnalyzeComponentRequest(string ComponentType, string ImageDataUrl);

record SystemPositionAnalysisResponse(
    string SystemPositionId,
    double Confidence,
    string Notes,
    string Provider,
    bool RequiresManualConfirmation);

record ComponentAnalysisResponse(
    string ComponentType,
    string IdentifiedValue,
    double Confidence,
    string Notes,
    string Provider,
    bool RequiresManualConfirmation,
    Dictionary<string, string> SuggestedAttributes);

record CreateAggregateRequest(
    string SystemPositionId,
    string? Position,
    string? Department,
    string? Notes,
    string? SystemPositionImageDataUrl);

record CreateAggregateComponentRequest(
    string ComponentType,
    string IdentifiedValue,
    string? Notes,
    string? ImageDataUrl,
    Dictionary<string, string>? Attributes);

class VentilationAggregate
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string SystemPositionId { get; init; } = string.Empty;
    public string? Position { get; init; }
    public string? Department { get; init; }
    public string? Notes { get; init; }
    public string? SystemPositionImageDataUrl { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<AggregateComponentEntry> Components { get; } = new();
}

class AggregateComponentEntry
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string ComponentType { get; init; } = string.Empty;
    public string IdentifiedValue { get; init; } = string.Empty;
    public string? Notes { get; init; }
    public string? ImageDataUrl { get; init; }
    public Dictionary<string, string> Attributes { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}

class AggregateStore
{
    private readonly ConcurrentDictionary<Guid, VentilationAggregate> _aggregates = new();

    public AggregateStore()
    {
        var seeded = new VentilationAggregate
        {
            Id = Guid.NewGuid(),
            SystemPositionId = "VP-1001",
            Position = "Takplan 2",
            Department = "Produktion",
            Notes = "Seedad post for sok-laget",
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
            UpdatedAt = DateTimeOffset.UtcNow.AddHours(-2)
        };

        seeded.Components.Add(new AggregateComponentEntry
        {
            ComponentType = "Kilrep",
            IdentifiedValue = "SPA 1180",
            Notes = "Byttes nyligen",
            Attributes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["profil"] = "SPA",
                ["langd"] = "1180",
                ["antal"] = "2"
            },
            CreatedAt = DateTimeOffset.UtcNow.AddHours(-2)
        });

        _aggregates[seeded.Id] = seeded;
    }

    public VentilationAggregate Create(CreateAggregateRequest request)
    {
        var aggregate = new VentilationAggregate
        {
            Id = Guid.NewGuid(),
            SystemPositionId = request.SystemPositionId.Trim(),
            Position = request.Position?.Trim(),
            Department = request.Department?.Trim(),
            Notes = request.Notes?.Trim(),
            SystemPositionImageDataUrl = request.SystemPositionImageDataUrl,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        _aggregates[aggregate.Id] = aggregate;
        return aggregate;
    }

    public bool TryGet(Guid id, out VentilationAggregate? aggregate) =>
        _aggregates.TryGetValue(id, out aggregate);

    public IEnumerable<VentilationAggregate> Search(string? query)
    {
        var normalized = query?.Trim();

        return _aggregates.Values
            .Where(aggregate =>
                string.IsNullOrWhiteSpace(normalized) ||
                aggregate.SystemPositionId.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                (aggregate.Position?.Contains(normalized, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (aggregate.Department?.Contains(normalized, StringComparison.OrdinalIgnoreCase) ?? false) ||
                aggregate.Components.Any(component =>
                    component.ComponentType.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                    component.IdentifiedValue.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                    component.Attributes.Any(attribute =>
                        attribute.Key.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                        attribute.Value.Contains(normalized, StringComparison.OrdinalIgnoreCase))))
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ToArray();
    }

    public bool TryAddComponent(Guid aggregateId, CreateAggregateComponentRequest request, out VentilationAggregate? aggregate)
    {
        if (!_aggregates.TryGetValue(aggregateId, out var current))
        {
            aggregate = null;
            return false;
        }

        lock (current)
        {
            current.Components.Insert(0, new AggregateComponentEntry
            {
                Id = Guid.NewGuid(),
                ComponentType = request.ComponentType.Trim(),
                IdentifiedValue = request.IdentifiedValue.Trim(),
                Notes = request.Notes?.Trim(),
                ImageDataUrl = request.ImageDataUrl,
                Attributes = ComponentSchema.NormalizeAttributes(request.Attributes),
                CreatedAt = DateTimeOffset.UtcNow
            });
            current.UpdatedAt = DateTimeOffset.UtcNow;
        }

        aggregate = current;
        return true;
    }
}

interface IImageAnalysisService
{
    Task<SystemPositionAnalysisResponse> AnalyzeSystemPositionAsync(string imageDataUrl, CancellationToken cancellationToken);
    Task<ComponentAnalysisResponse> AnalyzeComponentAsync(string componentType, string imageDataUrl, CancellationToken cancellationToken);
}

class GeminiImageAnalysisService : IImageAnalysisService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient _httpClient;
    private readonly ILogger<GeminiImageAnalysisService> _logger;
    private readonly string? _apiKey;
    private readonly string _model;

    public GeminiImageAnalysisService(
        HttpClient httpClient,
        IConfiguration configuration,
        ILogger<GeminiImageAnalysisService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _apiKey = configuration["GEMINI_API_KEY"];
        _model = configuration["GEMINI_MODEL"] ?? "gemini-2.0-flash";
    }

    public async Task<SystemPositionAnalysisResponse> AnalyzeSystemPositionAsync(
        string imageDataUrl,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            return new SystemPositionAnalysisResponse(
                SystemPositionId: "MANUELL-KRAVS",
                Confidence: 0.15,
                Notes: "GEMINI_API_KEY saknas. Ange nyckel och bekrafta ID manuellt tills dess.",
                Provider: "fallback",
                RequiresManualConfirmation: true);
        }

        var prompt =
            "Du ar OCR-assistent. Las endast systempositionens ID fran bilden. " +
            "Returnera ENDAST JSON med falten systemPositionId, confidence och notes. " +
            "Om osaker, satt confidence lagre men gissa ett rimligt ID-format. Inga markdown-block.";

        var raw = await GenerateContentAsync(prompt, imageDataUrl, cancellationToken);
        var parsed = TryParseJson<SystemPositionGeminiDto>(raw);

        var id = SanitizeSystemPositionId(parsed?.SystemPositionId);
        if (string.IsNullOrWhiteSpace(id))
        {
            id = "OKAND";
        }

        return new SystemPositionAnalysisResponse(
            SystemPositionId: id,
            Confidence: ClampConfidence(parsed?.Confidence ?? 0.45),
            Notes: string.IsNullOrWhiteSpace(parsed?.Notes)
                ? "Kontrollera ID innan du sparar."
                : parsed!.Notes!,
            Provider: "gemini",
            RequiresManualConfirmation: true);
    }

    public async Task<ComponentAnalysisResponse> AnalyzeComponentAsync(
        string componentType,
        string imageDataUrl,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            var fallbackAttributes = ComponentSchema.CreateEmptyAttributes(componentType);
            return new ComponentAnalysisResponse(
                ComponentType: componentType,
                IdentifiedValue: $"Manuell avlasning: {componentType}",
                Confidence: 0.1,
                Notes: "GEMINI_API_KEY saknas. Fyll i komponentens beteckning manuellt.",
                Provider: "fallback",
                RequiresManualConfirmation: true,
                SuggestedAttributes: fallbackAttributes);
        }

        var requiredFields = ComponentSchema.GetRequiredFields(componentType);
        var requiredText = requiredFields.Length == 0
            ? "inga specifika falt"
            : string.Join(", ", requiredFields);

        var prompt =
            $"Du analyserar ventilationskomponenten '{componentType}'. " +
            $"Obligatoriska falt for denna komponent ar: {requiredText}. " +
            "Returnera ENDAST JSON med falten componentType, identifiedValue, confidence, notes och suggestedAttributes. " +
            "suggestedAttributes ska vara ett objekt med nyckel/varde for dessa falt. " +
            "identifiedValue ska vara kort och praktiskt, t.ex. modell/beteckning/typ. Inga markdown-block.";

        var raw = await GenerateContentAsync(prompt, imageDataUrl, cancellationToken);
        var parsed = TryParseJson<ComponentGeminiDto>(raw);

        var identified = string.IsNullOrWhiteSpace(parsed?.IdentifiedValue)
            ? $"Okand {componentType}"
            : parsed!.IdentifiedValue!.Trim();

        var suggestedAttributes = ComponentSchema.FillMissingAttributes(
            componentType,
            ComponentSchema.NormalizeAttributes(parsed?.SuggestedAttributes));

        return new ComponentAnalysisResponse(
            ComponentType: componentType,
            IdentifiedValue: identified,
            Confidence: ClampConfidence(parsed?.Confidence ?? 0.5),
            Notes: string.IsNullOrWhiteSpace(parsed?.Notes)
                ? "Bekrafta komponentdata innan sparning."
                : parsed!.Notes!,
            Provider: "gemini",
            RequiresManualConfirmation: true,
            SuggestedAttributes: suggestedAttributes);
    }

    private async Task<string> GenerateContentAsync(
        string prompt,
        string imageDataUrl,
        CancellationToken cancellationToken)
    {
        var (mimeType, base64Data) = ParseDataUrl(imageDataUrl);

        var payload = new
        {
            contents = new[]
            {
                new
                {
                    parts = new object[]
                    {
                        new { text = prompt },
                        new { inline_data = new { mime_type = mimeType, data = base64Data } }
                    }
                }
            },
            generationConfig = new
            {
                temperature = 0.1
            }
        };

        using var response = await _httpClient.PostAsJsonAsync(
            $"v1beta/models/{_model}:generateContent?key={_apiKey}",
            payload,
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning("Gemini call failed: {StatusCode} {Body}", response.StatusCode, body);
            throw new InvalidOperationException("Gemini-svaret blev inte godkant.");
        }

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var text = ExtractCandidateText(document.RootElement);

        if (string.IsNullOrWhiteSpace(text))
        {
            throw new InvalidOperationException("Inget tolkningsbart svar fran Gemini.");
        }

        return CleanupJsonText(text);
    }

    private static string ExtractCandidateText(JsonElement root)
    {
        if (!root.TryGetProperty("candidates", out var candidates) || candidates.GetArrayLength() == 0)
        {
            return string.Empty;
        }

        var firstCandidate = candidates[0];
        if (!firstCandidate.TryGetProperty("content", out var content) ||
            !content.TryGetProperty("parts", out var parts) ||
            parts.GetArrayLength() == 0)
        {
            return string.Empty;
        }

        foreach (var part in parts.EnumerateArray())
        {
            if (part.TryGetProperty("text", out var textProperty))
            {
                return textProperty.GetString() ?? string.Empty;
            }
        }

        return string.Empty;
    }

    private static T? TryParseJson<T>(string raw) where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(raw, JsonOptions);
        }
        catch
        {
            var jsonStart = raw.IndexOf('{');
            var jsonEnd = raw.LastIndexOf('}');
            if (jsonStart >= 0 && jsonEnd > jsonStart)
            {
                var sliced = raw.Substring(jsonStart, jsonEnd - jsonStart + 1);
                try
                {
                    return JsonSerializer.Deserialize<T>(sliced, JsonOptions);
                }
                catch
                {
                    return null;
                }
            }

            return null;
        }
    }

    private static string SanitizeSystemPositionId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var upper = value.ToUpperInvariant();
        var allowed = Regex.Replace(upper, "[^A-Z0-9-]", string.Empty);
        return allowed.Trim('-');
    }

    private static string CleanupJsonText(string value)
    {
        var trimmed = value.Trim();

        if (trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            var withoutTicks = trimmed.Trim('`');
            var firstBrace = withoutTicks.IndexOf('{');
            if (firstBrace >= 0)
            {
                return withoutTicks[firstBrace..].Trim();
            }
        }

        return trimmed;
    }

    private static double ClampConfidence(double confidence) =>
        Math.Clamp(confidence, 0, 1);

    private static (string MimeType, string Base64Data) ParseDataUrl(string dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl))
        {
            throw new InvalidOperationException("Tom bilddata.");
        }

        if (!dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return ("image/jpeg", dataUrl.Trim());
        }

        var comma = dataUrl.IndexOf(',');
        if (comma < 0)
        {
            throw new InvalidOperationException("Ogiltigt data-url format.");
        }

        var header = dataUrl[..comma];
        var payload = dataUrl[(comma + 1)..];

        var semicolon = header.IndexOf(';');
        var mimeType = semicolon > 5
            ? header[5..semicolon]
            : "image/jpeg";

        return (mimeType, payload);
    }

    private sealed class SystemPositionGeminiDto
    {
        public string? SystemPositionId { get; set; }
        public double Confidence { get; set; }
        public string? Notes { get; set; }
    }

    private sealed class ComponentGeminiDto
    {
        public string? ComponentType { get; set; }
        public string? IdentifiedValue { get; set; }
        public double Confidence { get; set; }
        public string? Notes { get; set; }
        public Dictionary<string, string>? SuggestedAttributes { get; set; }
    }
}

static class ComponentSchema
{
    private static readonly Dictionary<string, string[]> RequiredByComponent = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Motorbricka"] = new[] { "motorModell", "lagerTyp", "lagerAntal" },
        ["Flakt"] = new[] { "flaktTyp", "diameterMm", "rotationsriktning" },
        ["Kilrep"] = new[] { "profil", "langd", "antal" },
        ["Remskivor"] = new[] { "drivskiva", "medskiva", "diameterMm" },
        ["Filter"] = new[] { "filterklass", "dimension", "antal" }
    };

    public static string[] AllTypes => RequiredByComponent.Keys.OrderBy(key => key).ToArray();

    public static bool IsKnownType(string componentType) =>
        RequiredByComponent.ContainsKey(componentType.Trim());

    public static string[] GetRequiredFields(string componentType) =>
        RequiredByComponent.TryGetValue(componentType.Trim(), out var fields)
            ? fields
            : Array.Empty<string>();

    public static Dictionary<string, string> CreateEmptyAttributes(string componentType)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var field in GetRequiredFields(componentType))
        {
            result[field] = string.Empty;
        }

        return result;
    }

    public static Dictionary<string, string> NormalizeAttributes(Dictionary<string, string>? attributes)
    {
        var normalized = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (attributes is null)
        {
            return normalized;
        }

        foreach (var pair in attributes)
        {
            var key = pair.Key?.Trim();
            if (string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            normalized[key] = pair.Value?.Trim() ?? string.Empty;
        }

        return normalized;
    }

    public static Dictionary<string, string> FillMissingAttributes(
        string componentType,
        Dictionary<string, string> source)
    {
        var merged = new Dictionary<string, string>(source, StringComparer.OrdinalIgnoreCase);
        foreach (var field in GetRequiredFields(componentType))
        {
            if (!merged.ContainsKey(field))
            {
                merged[field] = string.Empty;
            }
        }

        return merged;
    }

    public static string[] GetMissingRequiredFields(
        string componentType,
        Dictionary<string, string>? attributes)
    {
        var required = GetRequiredFields(componentType);
        if (required.Length == 0)
        {
            return Array.Empty<string>();
        }

        var normalized = NormalizeAttributes(attributes);
        return required
            .Where(field =>
                !normalized.TryGetValue(field, out var value) ||
                string.IsNullOrWhiteSpace(value))
            .ToArray();
    }
}

class ObjectStore
{
    private readonly ConcurrentDictionary<string, Objekt> _objects = new();
    private readonly ConcurrentQueue<Observation> _observations = new();

    public ObjectStore()
    {
        var seed = new[]
        {
            new Objekt(
                "lift-23",
                "SkyLift 23",
                "Lift",
                "Verkstad Nord",
                new[] { "hydraulik", "besiktigad" },
                DateTimeOffset.UtcNow.AddDays(-2),
                new[]
                {
                    new Equipment("bat-1", "Batteripack 48V", 2, "ok"),
                    new Equipment("selar", "Fallskyddssele", 2, "saknas")
                },
                DateTimeOffset.UtcNow.AddDays(-13).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            ),
            new Objekt(
                "generator-07",
                "Generator 07",
                "Energi",
                "Region Syd",
                new[] { "kritisk" },
                DateTimeOffset.UtcNow.AddDays(-6),
                new[]
                {
                    new Equipment("olja", "Oljefilter", 2, "ok")
                },
                DateTimeOffset.UtcNow.AddDays(-80).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            )
        };

        foreach (var obj in seed)
        {
            _objects[obj.Id] = obj;
        }
    }

    public IEnumerable<Objekt> GetAll() => _objects.Values;

    public bool Exists(string id) => _objects.ContainsKey(id);

    public Objekt Add(CreateObjectRequest request)
    {
        var obj = new Objekt(
            id: request.Name.ToLowerInvariant().Replace(' ', '-'),
            request.Name,
            request.Category,
            request.Location,
            request.Tags,
            DateTimeOffset.UtcNow,
            Array.Empty<Equipment>(),
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

        _objects[obj.Id] = obj;
        return obj;
    }

    public async Task AddObservation(Observation observation)
    {
        await Task.Delay(20);
        _observations.Enqueue(observation);
    }

    public IEnumerable<Observation> GetObservations() => _observations.ToArray();
}
