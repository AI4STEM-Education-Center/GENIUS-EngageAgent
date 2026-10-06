import type { MaterialActivity } from "@/lib/material-activities";

// Authored fixtures, not claims about live model output.
export const analogyActivity: MaterialActivity = {
  version: 1,
  mappingDepth: "configurations",
  analogyMapping: {
    target: "Metal coil spring", analogue: "Folded paper accordion",
    correspondences: [
      { targetPart: "Neighboring turns", analoguePart: "Neighboring folds", relationship: "Repeated units have gaps between them." },
      { targetPart: "Spacing along the spring", analoguePart: "Spacing along the accordion", relationship: "The arrangement of repeated units contributes to the whole object's length." },
    ],
  },
  stages: [
    { id: "target", title: "Inside a spring", text: "A metal coil spring can become longer under a gentle pull. Inspect the turns in this simplified drawing. What might change about their arrangement? Keep your first idea in mind without trying to explain the return motion yet." },
    { id: "analogue", title: "A familiar arrangement", text: "Picture a paper strip folded into an accordion. Notice its repeated folds and the gaps between them. Which features would you inspect to describe how spread out the folds are?" },
    { id: "mapping", title: "Compare the arrangements", text: "Compare neighboring spring turns on the left with neighboring paper folds on the right. How do gaps between repeated units contribute to each object's length? Use these schematic drawings to consider the arrangement, not microscopic structure." },
    { id: "limits", title: "Where the comparison stops", text: "Paper folds and metal coils bend differently. The repeated arrangement is the comparison; paper does not necessarily spring back on its own. This model does not explain the forces that return the metal spring." },
    { id: "question", title: "What would you investigate?", text: "Write one scientific question about the spring that this comparison leaves open. Start with How, Why, or How could we test. Keep your question for the lesson." },
  ],
  image: { revealAt: 2, scene: "A metal coil spring beside a folded paper accordion, with gaps between neighboring units visible.", panels: [
    { description: "A horizontal metal coil spring held gently at both ends, with separate neighboring turns and clear gaps; the entire spring and contact points are in frame. One static state, white background.", caption: "Metal coil spring", alt: "A metal coil spring with gaps between neighboring turns." },
    { description: "A horizontal folded blue paper accordion held open at both ends, with visible repeated folds and gaps. One static state, white background, entire object in frame.", caption: "Paper accordion", alt: "A blue paper accordion with gaps between neighboring folds." },
  ] },
};

export const conflictActivity: MaterialActivity = {
  version: 1,
  observedOutcome: "The ball flattens briefly during contact and becomes round again afterward.",
  stages: [
    { id: "phenomenon", title: "A quick bounce", text: "A small rubber ball drops onto a hard floor and bounces. Before and after the bounce, it looks round. Imagine looking closely at the very brief moment when it touches the floor." },
    { id: "prediction", title: "Predict before looking", text: "Would the ball keep exactly the same shape while touching the floor, or would its shape change? Write your prediction and one reason. Keep the same ball and floor in mind." },
    { id: "discrepant", title: "Look at the contact", text: "The three panels are a schematic, not camera measurements: before contact, during contact, and after contact. They show the rubber ball flattening briefly against the floor, then becoming round again. What did you notice that the before-and-after views alone could hide?" },
    { id: "compare", title: "Compare your ideas", text: "What we observed in the activity: The ball flattens briefly during contact and becomes round again afterward.\nHow did what we observed match or differ from your recorded prediction?" },
    { id: "question", title: "Investigate the gap", text: "Write one scientific question that could help explain what happens during contact. Try Why does, Under what conditions, or How could we test. Save the explanation for the investigation." },
  ],
  image: { revealAt: 2, scene: "The same red rubber ball before, during and after contact with a gray floor.", panels: [
    { description: "Round red rubber ball just above a horizontal gray floor, fully in frame.", caption: "Before contact", alt: "A round red ball above a gray floor." },
    { description: "The same red rubber ball touching the same floor, slightly wider and shorter with a flattened contact area; approximately unchanged volume, fully in frame.", caption: "During contact", alt: "The red ball is flattened slightly against the floor." },
    { description: "The same red rubber ball round again just above the same floor after contact, fully in frame.", caption: "After contact", alt: "The red ball is round again above the floor." },
  ] },
};

export const bridgingActivity: MaterialActivity = {
  version: 1,
  stages: [
    { id: "experience", title: "A landing you remember", text: "Think of a time you caught a soft ball or saw one land on a cushion. Where was it, and what happened? If neither is familiar, imagine gently pressing a foam sponge with your finger. Describe one specific moment." },
    { id: "notice", title: "Look more closely", text: "Inspect the cushion where the ball rests in this illustration. Compare its surface directly under the ball with its surface farther away. What detail might you overlook at first? Recall what happened when a load was removed from a soft seat." },
    { id: "name", title: "A name for the change", text: "Science calls a change in an object's shape deformation. You have been noticing deformation in this everyday landing. Where does it appear in the cushion, and when does it disappear? Naming the change does not yet tell us why it happens." },
    { id: "connect", title: "Notice it elsewhere", text: "Think about pressing a sponge and sitting on a soft seat. These are more examples of objects changing shape, not stand-ins for the cushion. What visible pattern do they share?" },
    { id: "question", title: "Your next question", text: "Write one scientific question about a shape change you have noticed. You could begin What if or Under what conditions. Bring that question into our investigation of collisions." },
  ],
  image: { revealAt: 1, scene: "A red ball resting in a slight indentation on a blue cushion.", panels: [
    { description: "One red ball resting on a soft blue fabric cushion, touching the cushion in a shallow indentation directly beneath the ball. Cushion edges remain visible and unchanged. One frozen moment, familiar classroom setting.", caption: "A ball on a cushion", alt: "A red ball rests in a shallow indentation in a blue cushion." },
  ] },
};
