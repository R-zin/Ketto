const example = (
  id: string,
  name: string,
  image: string,
  zones: { name: string; x: number; y: number; description: string }[],
) => ({
  id,
  name,
  image,
  demo: true,
  image_id: null,
  zones: zones.map((zone, index) => ({
    ...zone,
    id: `${id}-zone-${index}`,
    floor_id: id,
    demo: true,
    volunteers: 0,
    openIssues: 0,
  })),
});

export const exampleFloors = [
  example(
    "example-hackathon-floor-2",
    "Floor 2 · Academic block",
    "/hackathon-floor-2.svg",
    [
      {
        name: "Hall 201",
        x: 0.205,
        y: 0.315,
        description:
          "Main hacking hall with team desks, power points and space for collaborative work.",
      },
      {
        name: "Hall 202",
        x: 0.79,
        y: 0.315,
        description:
          "Second hacking hall for additional teams and quieter project work.",
      },
      {
        name: "Workshop 203",
        x: 0.205,
        y: 0.7,
        description:
          "Technical workshops and sponsor sessions during the hackathon.",
      },
      {
        name: "Mentor room 204",
        x: 0.79,
        y: 0.7,
        description: "Office hours, debugging help and mentor consultations.",
      },
      {
        name: "Registration",
        x: 0.5,
        y: 0.81,
        description:
          "Participant check-in, badges and the event help desk beside the main entrance.",
      },
      {
        name: "Stairs / lift",
        x: 0.5,
        y: 0.235,
        description:
          "Shared vertical access to Floor 4 and the ground-floor canteen.",
      },
    ],
  ),
  example(
    "example-hackathon-floor-4",
    "Floor 4 · Innovation block",
    "/hackathon-floor-4.svg",
    [
      {
        name: "Lab 401",
        x: 0.205,
        y: 0.315,
        description:
          "Hardware, robotics and prototyping workspaces for hackathon teams.",
      },
      {
        name: "Demo hall 402",
        x: 0.79,
        y: 0.315,
        description:
          "Project demonstrations, presentations and the final pitch session.",
      },
      {
        name: "Judging 403",
        x: 0.205,
        y: 0.7,
        description: "Judging interviews and project evaluation sessions.",
      },
      {
        name: "Lounge 404",
        x: 0.79,
        y: 0.7,
        description: "A quiet rest area and informal networking space.",
      },
      {
        name: "Stairs / lift",
        x: 0.5,
        y: 0.235,
        description: "Shared vertical access to Floor 2 and the canteen.",
      },
      {
        name: "Help desk",
        x: 0.5,
        y: 0.81,
        description:
          "Event support for judging schedules, demo slots and accessibility assistance.",
      },
    ],
  ),
  example(
    "example-hackathon-canteen",
    "Canteen · Ground floor",
    "/hackathon-canteen.svg",
    [
      {
        name: "Dining area",
        x: 0.245,
        y: 0.36,
        description:
          "Shared dining tables for participants, mentors and volunteers.",
      },
      {
        name: "Food counter",
        x: 0.76,
        y: 0.285,
        description:
          "Meal service and snack collection, with a separate queue lane.",
      },
      {
        name: "Kitchen",
        x: 0.76,
        y: 0.65,
        description:
          "Food preparation and storage. Staff access only in this example.",
      },
      {
        name: "Water station",
        x: 0.22,
        y: 0.76,
        description: "Drinking-water refill points beside the dining area.",
      },
      {
        name: "First aid",
        x: 0.49,
        y: 0.76,
        description: "An example first-aid room close to the canteen entrance.",
      },
      {
        name: "Entrance",
        x: 0.5,
        y: 0.9,
        description:
          "Entrance from the campus walkway. The academic-block stairs and lift are nearby.",
      },
    ],
  ),
];

// Store a raster image through the same safe image-upload path as a real plan.
export async function examplePlanImage(source: string): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the floor plan");
  context.drawImage(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not prepare the floor plan")),
      "image/png",
    ),
  );
}
