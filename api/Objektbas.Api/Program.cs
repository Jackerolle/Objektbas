using System.Collections.Concurrent;
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

var app = builder.Build();

app.UseCors("web-client");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.MapGet("/objects", (ObjectStore store) =>
    Results.Ok(store.GetAll()));

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

app.MapGet("/observations", (ObjectStore store) =>
    Results.Ok(store.GetObservations()));

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
                DateTimeOffset.UtcNow.AddDays(-13).ToString("yyyy-MM-dd")
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
                DateTimeOffset.UtcNow.AddDays(-80).ToString("yyyy-MM-dd")
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
            id: request.Name.ToLower().Replace(' ', '-'),
            request.Name,
            request.Category,
            request.Location,
            request.Tags,
            DateTimeOffset.UtcNow,
            Array.Empty<Equipment>(),
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd"));

        _objects[obj.Id] = obj;
        return obj;
    }

    public async Task AddObservation(Observation observation)
    {
        // Simulera IO
        await Task.Delay(20);
        _observations.Enqueue(observation);
    }

    public IEnumerable<Observation> GetObservations() => _observations.ToArray();
}
