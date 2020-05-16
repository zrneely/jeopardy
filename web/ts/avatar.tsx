import React from 'react';

enum Color {
    Black = 'black',
    Red = 'red',
    Orange = 'orange',
    Green = 'green',
    Blue = 'blue',
    Purple = 'purple',
    White = 'white',
}
function colorToTarget(color: Color): number {
    switch (color) {
        case Color.Black: return 0xFF000000;
        case Color.Red: return 0xFF0000FF;
        case Color.Orange: return 0xFF00A5FF;
        case Color.Green: return 0xFF008000;
        case Color.Blue: return 0xFFFF0000;
        case Color.Purple: return 0xFF800080;
        case Color.White: return 0xFFFFFFFF;
    }
}

enum Tool {
    Thin = 'Thin',
    Thicc = 'Thicc',
    Flood = 'Flood',
}

interface AvatarInputProps {
    width: number,
    height: number,
    localStorageKey: string,
}
interface AvatarInputState {
    image: string | null, // data URL
    color: Color,
    tool: Tool,
}
export class AvatarInput extends React.Component<AvatarInputProps, AvatarInputState> {
    state: AvatarInputState = {
        image: null,
        tool: Tool.Thicc,
        color: Color.Black,
    }

    private canvasRef = React.createRef<HTMLCanvasElement>();
    private canvasContext: CanvasRenderingContext2D | null = null;

    // Store this state off of React state - it shouldn't trigger rerenders
    private isMouseDown: boolean = false;
    private lastDrawX: number = -1;
    private lastDrawY: number = -1;

    constructor(props: AvatarInputProps) {
        super(props);

        this.clearImage = this.clearImage.bind(this);
        this.canvasMouseDown = this.canvasMouseDown.bind(this);
        this.canvasMouseUp = this.canvasMouseUp.bind(this);
        this.canvasMouseMove = this.canvasMouseMove.bind(this);
        this.canvasMouseLeave = this.canvasMouseLeave.bind(this);
        this.setColor = this.setColor.bind(this);
        this.setTool = this.setTool.bind(this);
    }

    saveImage() {
        if (this.canvasRef.current !== null) {
            const image = this.canvasRef.current.toDataURL();
            this.setState({
                image,
            });

            localStorage.setItem(this.props.localStorageKey, image);
            localStorage.setItem(this.props.localStorageKey + '-tool', JSON.stringify({
                tool: this.state.tool,
                color: this.state.color,
            }));
        }
    }

    clearImage() {
        if (this.canvasContext !== null) {
            this.canvasContext.fillStyle = Color.White;
            this.canvasContext.fillRect(0, 0, this.props.width, this.props.height);

            this.saveImage();
        }
    }

    handleFlood(x: number, y: number) {
        if (this.canvasContext === null) {
            return;
        }

        interface PixelData {
            width: number,
            height: number,
            data: Uint32Array,
        }

        const fillColor = colorToTarget(this.state.color);

        x = Math.round(x);
        y = Math.round(y);

        const getPixel = (pixelData: PixelData, x: number, y: number) => {
            if (x < 0 || y < 0 || x >= pixelData.width || y >= pixelData.height) {
                return -1;
            } else {
                return pixelData.data[y * pixelData.width + x];
            }
        };

        const setPixel = (pixelData: PixelData, x: number, y: number) => {
            pixelData.data[y * pixelData.width + x] = fillColor;
        };

        const imageData = this.canvasContext.getImageData(0, 0, this.props.width, this.props.height);
        const pixelData: PixelData = {
            width: imageData.width,
            height: imageData.height,
            data: new Uint32Array(imageData.data.buffer),
        };

        let checked = 0;
        const checkLimit = this.props.width * this.props.height * 4;

        const targetColor = getPixel(pixelData, x, y);
        const pixelsToCheck = [x, y];
        while (pixelsToCheck.length > 1) {
            if (checked > checkLimit) {
                console.warn('flood fill checked to many pixels; bailing!');
                break;
            }

            const y = pixelsToCheck.pop()!;
            const x = pixelsToCheck.pop()!;
            const currentColor = getPixel(pixelData, x, y);
            if (currentColor === targetColor) {
                setPixel(pixelData, x, y);
                pixelsToCheck.push(x + 1, y);
                pixelsToCheck.push(x - 1, y);
                pixelsToCheck.push(x, y + 1);
                pixelsToCheck.push(x, y - 1);
            }

            checked += 1;
        }

        this.canvasContext.putImageData(imageData, 0, 0);
    }

    fixCoords(e: React.MouseEvent): [number, number] {
        if (this.canvasRef.current !== null) {
            const bounds = this.canvasRef.current.getBoundingClientRect();
            return [e.clientX - bounds.x, e.clientY - bounds.y];
        } else {
            return [-1, -1];
        }
    }

    canvasMouseDown(e: React.PointerEvent) {
        this.isMouseDown = true;
        if (this.canvasContext !== null) {
            const [x, y] = this.fixCoords(e);
            this.lastDrawX = x;
            this.lastDrawY = y;
        }
    }

    canvasMouseUp(e: React.PointerEvent) {
        this.isMouseDown = false;

        if (this.canvasContext !== null) {
            const [x, y] = this.fixCoords(e);

            let radius = 0;
            switch (this.state.tool) {
                case Tool.Thin: {
                    radius = 2;
                    break;
                }
                case Tool.Thicc: {
                    radius = 4;
                    break;
                }
                case Tool.Flood: {
                    this.handleFlood(x, y);
                    return;
                }
            }

            if (this.lastDrawX == x && this.lastDrawY == y) {
                this.canvasContext.beginPath();
                this.canvasContext.arc(x, y, radius, 0, 2 * Math.PI, false);
                this.canvasContext.fillStyle = this.state.color;
                this.canvasContext.closePath();
                this.canvasContext.fill();
            }
        }

        this.saveImage();
    }

    canvasMouseMove(e: React.PointerEvent) {
        if (this.isMouseDown && this.canvasContext !== null) {
            const [x, y] = this.fixCoords(e);

            switch (this.state.tool) {
                case Tool.Thin: {
                    this.canvasContext.lineWidth = 2;
                    break;
                }
                case Tool.Thicc: {
                    this.canvasContext.lineWidth = 8;
                    break;
                }

                case Tool.Flood:
                default: {
                    // Don't handle the flood case here
                    return;
                }
            }

            this.canvasContext.beginPath();
            this.canvasContext.moveTo(this.lastDrawX, this.lastDrawY);
            this.canvasContext.lineJoin = 'round';
            this.canvasContext.strokeStyle = this.state.color;
            this.canvasContext.lineTo(x, y);
            this.canvasContext.closePath();
            this.canvasContext.stroke();

            this.lastDrawX = x;
            this.lastDrawY = y;
        }
    }

    canvasMouseLeave() {
        this.isMouseDown = false;
        this.saveImage();
    }

    setColor(color: Color) {
        this.setState({
            color,
        });
    }

    setTool(tool: Tool) {
        this.setState({
            tool,
        });
    }

    componentDidMount() {
        if (this.canvasRef.current !== null) {
            this.canvasContext = this.canvasRef.current.getContext('2d');
            if (this.canvasContext !== null) {
                this.canvasContext.imageSmoothingEnabled = false;
            }

            const existingImageData = localStorage.getItem(this.props.localStorageKey);
            const existingToolData = localStorage.getItem(this.props.localStorageKey + '-tool');
            if ((existingImageData !== null) && (existingToolData !== null)) {
                const img = new Image;
                img.onload = () => {
                    this.canvasContext?.drawImage(img, 0, 0);
                }
                img.src = existingImageData;

                const toolData = JSON.parse(existingToolData);

                this.setState({
                    image: existingImageData,
                    tool: toolData.tool,
                    color: toolData.color,
                });
            } else {
                this.clearImage();
            }
        }
    }

    componentWillUnmount() {
        this.canvasContext = null;
    }

    render() {
        return <div className="avatar-input">
            <canvas
                width={this.props.width}
                height={this.props.height}
                onPointerDown={this.canvasMouseDown}
                onPointerUp={this.canvasMouseUp}
                onPointerMove={this.canvasMouseMove}
                onPointerOut={this.canvasMouseLeave}
                onMouseOut={this.canvasMouseLeave}
                style={{
                    width: this.props.width,
                    height: this.props.height,
                }}
                ref={this.canvasRef} />

            <div className="avatar-input-panel">
                <div className="avatar-color-buttons">
                    <button onClick={() => this.setColor(Color.Red)} className="avatar-button-color-red" />
                    <button onClick={() => this.setColor(Color.Orange)} className="avatar-button-color-orange" />
                    <button onClick={() => this.setColor(Color.Green)} className="avatar-button-color-green" />
                    <button onClick={() => this.setColor(Color.Blue)} className="avatar-button-color-blue" />
                    <button onClick={() => this.setColor(Color.Purple)} className="avatar-button-color-purple" />
                    <button onClick={() => this.setColor(Color.Black)} className="avatar-button-color-black" />
                    <button onClick={() => this.setColor(Color.White)} className="avatar-button-color-white" />
                </div>

                <div className="avatar-input-second-panel">
                    <div className="avatar-input-color-display" style={{
                        backgroundColor: this.state.color,
                    }}>&nbsp;</div>

                    <div className="avatar-input-tool-select">
                        <div>
                            <input
                                type="radio"
                                name="avatar-input-tool-select"
                                id="avatar-input-tool-select-thin"
                                checked={this.state.tool === Tool.Thin}
                                onChange={() => this.setTool(Tool.Thin)} />
                            <label htmlFor="avatar-input-tool-select-thin">Thin</label>
                        </div>
                        <div>
                            <input
                                type="radio"
                                name="avatar-input-tool-select"
                                id="avatar-input-tool-select-thicc"
                                checked={this.state.tool === Tool.Thicc}
                                onChange={() => this.setTool(Tool.Thicc)} />
                            <label htmlFor="avatar-input-tool-select-thicc">Thick</label>
                        </div>
                        <div>
                            <input
                                type="radio"
                                name="avatar-input-tool-select"
                                id="avatar-input-tool-select-flood"
                                checked={this.state.tool === Tool.Flood}
                                onChange={() => this.setTool(Tool.Flood)} />
                            <label htmlFor="avatar-input-tool-select-flood">Fill</label>
                        </div>
                    </div>
                </div>

                <button className="avatar-input-reset" onClick={this.clearImage}>Clear</button>
            </div>
        </div >;
    }
}