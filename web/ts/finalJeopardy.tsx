import React from 'react';
import { ServerData, JeopardyContext } from './common';

interface FinalJeopardyProps {
    players: { [player_id: string]: ServerData.Player },
    isModerator: boolean,
    question: ServerData.Clue | null,
    answersLocked: boolean,
}

interface FinalJeopardyState {

}

export class FinalJeopardy extends React.Component<FinalJeopardyProps, FinalJeopardyState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

    state = {

    };

    wagerInput = React.createRef<HTMLInputElement>();
    answerInput = React.createRef<HTMLInputElement>();

    render() {
        return <div className="final-jeopardy">
            TODO
        </div>;
    }
}