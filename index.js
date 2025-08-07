const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;




//middleware
app.use(cors());
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cjuyyb2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        const menuCollection = client.db("bistroDb").collection("menu")
        const userCollection = client.db("bistroDb").collection("users")
        const reviewCollection = client.db("bistroDb").collection("reviews")
        const cardCollection = client.db("bistroDb").collection("carts")
        const paymentsCollection = client.db("bistroDb").collection("payments")

        //jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })
        //middleweres
        const verifyToken = (req, res, next) => {
            console.log('inside verify token', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'forbidden access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'Unauthorized access - Invalid token' });
                }
                req.decoded = decoded;
                next()
            })



        }

        //users related api
        app.post('/users', async (req, res) => {
            const users = req.body;
            //insert email if user doesnt exists
            const query = { email: users.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(users);
            res.send(result)

        })

        //use verify admin after verifyToken
        const verifyAdmin = async(req, res, next)=>{
            const email = req.decoded.email;
            const query = {email: email};
            const user = await userCollection.findOne(query)
            const isAdmin = user?.role === 'admin';
            if(!isAdmin){
                return res.status(403).send({message: 'forbidden access'})
            }
            next()

        }

        app.get('/users/admin/:email', verifyToken, async(req, res)=>{
            const email = req.params.email;
            if(email !== req.decoded.email){
               return res.status(403).send({message:'unauthorized access'}) 
            }
            const query = {email: email};
            const user = await userCollection.findOne(query)
            let admin = false;
            if(user){
                admin = user.role === 'admin'
            }
          res.send({ admin })
        })

        app.get('/users', verifyToken,verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result)
        })

        app.delete('/users/:id', verifyToken, verifyAdmin,  async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result)
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result);
        })

        app.get('/menu', async  (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result)
        })
        app.get('/menu/:id', async(req, res)=>{
            const id = req.params.id;
            const query = {_id: new ObjectId(id)}
            const result = await menuCollection.findOne(query)
            res.send(result);
        })
        app.post('/menu',verifyToken, verifyAdmin, async(req, res)=>{
            const item = req.body;
            const result = await menuCollection.insertOne(item);
            res.send(result);
        });
        app.patch('/menu/:id', async(req, res)=>{
            const id = req.params.id;
            const data = req.body;
            const filter = {_id: new ObjectId(id)}
            const updateDoc = {
                $set: {
                  name: data.name,
                  category: data.category,
                  recipe: data.recipe,
                  image: data.image,
                  price: data.price,
                }
            }
            const result = await menuCollection.updateOne(filter, updateDoc)
            res.send(result);

        });
        app.delete('/menu/:id',verifyToken, verifyAdmin, async(req, res)=>{
            const id = req.params.id;
            const query = {_id: new ObjectId(id)} 
            const result = await menuCollection.deleteOne(query)
            res.send(result)
        })
        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray();
            res.send(result)
        })

        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cardCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cardCollection.insertOne(cartItem);
            res.send(result);
        })

        //Delete item
        app.delete('/carts/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cardCollection.deleteOne(query);
            res.send(result);
        })
        //payment intent 
        app.post('/create-payment-intent', async(req, res)=>{
            const {price} = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card'],
                
            });
            res.send({clientSecret: paymentIntent.client_secret})

        })
        
        app.post('/payments', async(req, res)=>{
           const payment = req.body;
           const insertResult = await paymentsCollection.insertOne(payment) 

           const query ={
            _id: {
                $in: payment.cartIds.map(id => new ObjectId(id))
            }
           }
           const deleteResult = await cardCollection.deleteMany(query)
           res.send({insertResult, deleteResult})
        })

        app.get('/payments/:email', verifyToken, async (req, res) =>{
            const email = req.params.email;
            
            const payments = await paymentsCollection
            .find({email: email})
            .sort({date: -1})
            .toArray();
            res.send(payments)
        })
        
        //states 
app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
  const users = await userCollection.estimatedDocumentCount();
  const menuItems = await menuCollection.estimatedDocumentCount();
  const orders = await paymentsCollection.estimatedDocumentCount();


  const payments = await paymentsCollection.find().toArray();
  const revenue = payments.reduce((total, payment) => total + payment.price, 0);
            // const result = await paymentsCollection.aggregate([
            //     {
            //         $group:{
            //             _id:null,
            //             totalRevenue:{
            //                 $sum: '$price'
            //             }
            //         }
            //     }
            // ]).toArray();
            // const revenue = result.length > 0 ? result[0].totalRevenue : 0;
             res.send({
    users,
    menuItems,
    orders,   //Mehenil Tasnim
    revenue
  });
});
       
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('boss is sitting')
})

app.listen(port, () => {
    console.log(`Bistro boss is sitting on port ${port}`);
})
